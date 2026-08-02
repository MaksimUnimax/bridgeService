/* global crypto */
(function (global) {
  "use strict";

  const LIFECYCLE_VERSION = "BB2D-L1";
  const PROFILE_KIND = "direct";
  const DEVICE_KEY_FORMAT = "SPKI_DER_BASE64URL";
  const SERVER_KEY_FORMAT = "SPKI_DER_BASE64URL";
  const SERVER_ALGORITHM = "ECDSA_P256_SHA256";
  const P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
  const P256_HALF_ORDER = P256_ORDER >> 1n;
  const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
  const B64URL = /^[A-Za-z0-9_-]+$/;
  const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const te = new TextEncoder();

  class DirectError extends Error {
    constructor(code, message = code) {
      super(message);
      this.name = "DirectError";
      this.code = code;
    }
  }
  const fail = (code, message) => { throw new DirectError(code, message); };

  function b64uEncode(value) {
    let raw = "";
    for (const byte of new Uint8Array(value)) raw += String.fromCharCode(byte);
    return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function b64uDecode(value, field = "base64") {
    if (typeof value !== "string" || !value || value.includes("=") || !B64URL.test(value)) fail(`invalid_${field}`);
    let raw;
    try {
      const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
      raw = atob(padded);
    } catch (_) {
      fail(`invalid_${field}`);
    }
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    if (b64uEncode(bytes) !== value) fail(`invalid_${field}`);
    return bytes;
  }

  function canonical(value) {
    const sort = (entry) => {
      if (Array.isArray(entry)) return entry.map(sort);
      if (entry && typeof entry === "object") {
        return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, sort(entry[key])]));
      }
      if (typeof entry === "number" && !Number.isFinite(entry)) fail("nonfinite_json");
      return entry;
    };
    return te.encode(JSON.stringify(sort(value)));
  }

  function domain(prefix, bytes) {
    const name = te.encode(`${prefix}\0`);
    const payload = new Uint8Array(bytes);
    const out = new Uint8Array(name.length + payload.length);
    out.set(name, 0);
    out.set(payload, name.length);
    return out;
  }

  function uintToBig(value) {
    return BigInt(`0x${[...new Uint8Array(value)].map((x) => x.toString(16).padStart(2, "0")).join("")}`);
  }

  function bigTo32(value) {
    const hex = value.toString(16).padStart(64, "0");
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function lowSP1363(rawValue) {
    const raw = new Uint8Array(rawValue);
    if (raw.length !== 64) fail("invalid_ecdsa_encoding");
    const r = uintToBig(raw.slice(0, 32));
    let s = uintToBig(raw.slice(32));
    if (!(r > 0n && r < P256_ORDER && s > 0n && s < P256_ORDER)) fail("invalid_ecdsa_signature");
    if (s > P256_HALF_ORDER) s = P256_ORDER - s;
    const out = new Uint8Array(64);
    out.set(bigTo32(r));
    out.set(bigTo32(s), 32);
    return out;
  }

  async function sign(privateKey, bytes) {
    const raw = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes);
    return b64uEncode(lowSP1363(raw));
  }

  async function verify(publicKey, signature, bytes) {
    const raw = b64uDecode(signature, "signature");
    if (raw.length !== 64) return false;
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, raw, bytes);
  }

  function validateIpv4(value) {
    if (typeof value !== "string") fail("invalid_host");
    const parts = value.split(".");
    if (parts.length !== 4) fail("invalid_host");
    for (const part of parts) {
      if (!/^\d+$/.test(part) || (part.length > 1 && part.startsWith("0"))) fail("invalid_host");
      const number = Number(part);
      if (!Number.isInteger(number) || number < 0 || number > 255 || String(number) !== part) fail("invalid_host");
    }
    return value;
  }

  function validateUuid(value, field) {
    if (typeof value !== "string" || !UUID4.test(value)) fail(`invalid_${field}`);
    return value;
  }

  function validateUtc(value, field) {
    if (typeof value !== "string" || !UTC_SECONDS.test(value)) fail(`invalid_${field}`);
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().replace(".000Z", "Z") !== value) fail(`invalid_${field}`);
    return ms;
  }

  function utcSeconds(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    const ms = date.getTime();
    if (!Number.isFinite(ms)) fail("invalid_time");
    return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
  }

  function directOrigin(host, port) {
    validateIpv4(host);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("invalid_port");
    return `http://${host}:${port}`;
  }

  function normalizeBundlePayload(bundle) {
    if (!bundle || typeof bundle !== "object") fail("invalid_bundle_payload");
    if (bundle.bundle_version !== "BB2D1") fail("invalid_bundle_version");
    validateIpv4(bundle.host);
    if (!Number.isInteger(bundle.port) || bundle.port < 1 || bundle.port > 65535) fail("invalid_port");
    validateUuid(bundle.instance_id, "instance_id");
    validateUuid(bundle.pairing_session_id, "pairing_session_id");
    if (typeof bundle.pairing_code !== "string" || !/^[0-9a-f]{32}$/.test(bundle.pairing_code)) fail("invalid_pairing_code");
    if (!Number.isInteger(bundle.rotation_generation) || bundle.rotation_generation < 1) fail("invalid_rotation_generation");
    if (bundle.server_public_key_format !== SERVER_KEY_FORMAT || bundle.server_signing_algorithm !== SERVER_ALGORITHM) fail("invalid_server_identity_format");
    if (typeof bundle.server_public_key !== "string" || !B64URL.test(bundle.server_public_key) || bundle.server_public_key.includes("=")) fail("invalid_server_public_key");
    if (typeof bundle.server_fingerprint !== "string" || !FINGERPRINT.test(bundle.server_fingerprint)) fail("invalid_server_fingerprint");
    const issued = validateUtc(bundle.issued_at, "issued_at");
    const expires = validateUtc(bundle.expires_at, "expires_at");
    if (expires <= issued || expires - issued < 300000 || expires - issued > 600000) fail("invalid_bundle_expiry");
    return { ...bundle };
  }

  async function importServerPublicKey(encoded) {
    const der = b64uDecode(encoded, "server_public_key");
    try {
      return await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    } catch (_) {
      fail("invalid_server_public_key");
    }
  }

  async function generateDeviceIdentity() {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    return Object.freeze({
      public_key: b64uEncode(spki),
      private_key: b64uEncode(pkcs8),
      public_key_format: DEVICE_KEY_FORMAT,
    });
  }

  async function importDevicePrivateKey(encoded) {
    const pkcs8 = b64uDecode(encoded, "device_private_key");
    try {
      return await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    } catch (_) {
      fail("invalid_device_private_key");
    }
  }

  function pairingRequest(bundle, devicePublicKey) {
    const value = normalizeBundlePayload(bundle);
    if (typeof devicePublicKey !== "string" || !B64URL.test(devicePublicKey) || devicePublicKey.includes("=")) fail("invalid_device_public_key");
    return {
      pairing_version: "1",
      pairing_session_id: value.pairing_session_id,
      pairing_code: value.pairing_code,
      device_public_key: devicePublicKey,
      device_public_key_format: DEVICE_KEY_FORMAT,
    };
  }

  function lifecycleUnsigned(profile, action, nowValue = Date.now()) {
    if (!profile || profile.kind !== PROFILE_KIND) fail("invalid_direct_profile");
    if (!new Set(["status", "revoke"]).has(action)) fail("invalid_lifecycle_action");
    validateUuid(profile.device_id, "device_id");
    const timestamp = utcSeconds(nowValue);
    const expiresAt = utcSeconds(Date.parse(timestamp) + 30000);
    return {
      lifecycle_version: LIFECYCLE_VERSION,
      action,
      device_id: profile.device_id,
      request_id: crypto.randomUUID(),
      timestamp,
      expires_at: expiresAt,
    };
  }

  async function lifecycleRequest(profile, privateKey, action, nowValue = Date.now()) {
    const request = lifecycleUnsigned(profile, action, nowValue);
    const transcript = canonical({
      action: request.action,
      device_id: request.device_id,
      expires_at: request.expires_at,
      lifecycle_version: LIFECYCLE_VERSION,
      method: "POST",
      path: "/v2/pairing/device",
      request_id: request.request_id,
      timestamp: request.timestamp,
    });
    return { ...request, signature: await sign(privateKey, domain("BB2D-L1/client-device", transcript)) };
  }

  async function verifyLifecycleResponse(profile, request, response, nowValue = Date.now()) {
    if (!response || typeof response !== "object" || Array.isArray(response)) fail("invalid_lifecycle_response");
    const expectedFields = ["lifecycle_version", "action", "device_id", "instance_id", "server_fingerprint", "request_id", "status", "timestamp", "expires_at", "signature"];
    const keys = Object.keys(response).sort();
    if (keys.length !== expectedFields.length || expectedFields.some((key) => !Object.prototype.hasOwnProperty.call(response, key))) fail("invalid_lifecycle_response");
    if (response.lifecycle_version !== LIFECYCLE_VERSION || response.action !== request.action || response.device_id !== profile.device_id || response.request_id !== request.request_id) fail("lifecycle_response_mismatch");
    if (response.instance_id !== profile.server_instance_id || response.server_fingerprint !== profile.server_fingerprint) fail("server_identity_changed");
    if (!new Set(["ACTIVE", "REVOKED"]).has(response.status)) fail("invalid_lifecycle_status");
    const timestamp = validateUtc(response.timestamp, "response_timestamp");
    const expires = validateUtc(response.expires_at, "response_expires_at");
    const now = nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
    if (!Number.isFinite(now) || expires <= timestamp || expires - timestamp > 60000 || expires <= now || Math.abs(now - timestamp) > 30000) fail("invalid_lifecycle_response_time");
    const publicKey = await importServerPublicKey(profile.server_public_key);
    const unsigned = { ...response };
    delete unsigned.signature;
    const signed = domain("BB2D-L1/server-device", canonical({ method: "POST", path: "/v2/pairing/device", status: 200, response: unsigned }));
    if (!await verify(publicKey, response.signature, signed)) fail("invalid_server_signature");
    return Object.freeze({ ...response });
  }

  function publicProfile(profile, hasPrivateKey = true) {
    if (!profile) return null;
    return {
      profile_id: profile.profile_id,
      kind: PROFILE_KIND,
      profile_revision: profile.profile_revision,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      origin: directOrigin(profile.host, profile.port),
      server_instance_id: profile.server_instance_id,
      server_fingerprint: profile.server_fingerprint,
      rotation_generation: profile.rotation_generation,
      device_id: profile.device_id,
      device_status: profile.device_status || "UNKNOWN",
      connection_state: profile.connection_state || "DISCONNECTED",
      identity_warning: profile.identity_warning || null,
      has_private_key: hasPrivateKey,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      last_verified_at: profile.last_verified_at || null,
      revoked_at: profile.revoked_at || null,
    };
  }

  global.BB2Direct = Object.freeze({
    DirectError,
    LIFECYCLE_VERSION,
    PROFILE_KIND,
    DEVICE_KEY_FORMAT,
    SERVER_KEY_FORMAT,
    SERVER_ALGORITHM,
    b64uEncode,
    b64uDecode,
    canonical,
    domain,
    sign,
    verify,
    utcSeconds,
    directOrigin,
    normalizeBundlePayload,
    importServerPublicKey,
    generateDeviceIdentity,
    importDevicePrivateKey,
    pairingRequest,
    lifecycleUnsigned,
    lifecycleRequest,
    verifyLifecycleResponse,
    publicProfile,
  });
})(globalThis);
