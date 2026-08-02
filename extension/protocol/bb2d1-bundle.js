// Browser-only BB2D1 connection-bundle parser. No DOM, storage, network or Node APIs.
export const BUNDLE_VERSION = 'BB2D1';
export const BUNDLE_MAX_LENGTH = 4096;
export const SERVER_SIGNING_ALGORITHM = 'ECDSA_P256_SHA256';
export const SERVER_PUBLIC_KEY_FORMAT = 'SPKI_DER_BASE64URL';

const FIELD_ORDER = Object.freeze([
  'bundle_version',
  'expires_at',
  'host',
  'instance_id',
  'issued_at',
  'pairing_code',
  'pairing_session_id',
  'port',
  'rotation_generation',
  'server_fingerprint',
  'server_public_key',
  'server_public_key_format',
  'server_signing_algorithm',
]);
const FIELD_SET = new Set(FIELD_ORDER);
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const te = new TextEncoder();
const fatalUtf8 = new TextDecoder('utf-8', {fatal: true});

export class BundleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BundleError';
    this.code = code;
  }
}

const fail = code => { throw new BundleError(code); };

function b64uEncode(bytes) {
  let s = '';
  for (const x of new Uint8Array(bytes)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64uDecode(value, field) {
  if (typeof value !== 'string' || !value || value.includes('=') || /[\r\n]/.test(value) || !B64URL.test(value)) {
    fail(`invalid_${field}`);
  }
  let raw;
  try {
    const std = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    raw = atob(std);
  } catch {
    fail(`invalid_${field}`);
  }
  const out = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (b64uEncode(out) !== value) fail(`invalid_${field}`);
  return out;
}

function equalBytes(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function parseUtcSeconds(value, field) {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) fail(`invalid_${field}`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(`invalid_${field}`);
  if (new Date(ms).toISOString().replace('.000Z', 'Z') !== value) fail(`invalid_${field}`);
  return ms;
}

function validateIpv4(value) {
  if (typeof value !== 'string') fail('invalid_host');
  const parts = value.split('.');
  if (parts.length !== 4) fail('invalid_host');
  for (const part of parts) {
    if (!/^\d+$/.test(part)) fail('invalid_host');
    if (part.length > 1 && part.startsWith('0')) fail('noncanonical_host');
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) fail('invalid_host');
    if (String(n) !== part) fail('noncanonical_host');
  }
  return value;
}

function validateUuid4(value, field) {
  if (typeof value !== 'string' || !UUID4.test(value)) fail(`invalid_${field}`);
  return value;
}

function canonicalPayloadObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_payload');
  const keys = Object.keys(value);
  if (keys.length !== FIELD_ORDER.length || keys.some(k => !FIELD_SET.has(k))) fail('invalid_payload');
  const out = {};
  for (const key of FIELD_ORDER) out[key] = value[key];
  return out;
}

function canonicalPayloadBytes(value) {
  return te.encode(JSON.stringify(canonicalPayloadObject(value)));
}

async function validateServerPublicKey(encoded, fingerprint) {
  const der = b64uDecode(encoded, 'server_public_key');
  if (der.length < 50 || der.length > 512) fail('invalid_server_public_key');
  try {
    await globalThis.crypto.subtle.importKey(
      'spki', der,
      {name: 'ECDSA', namedCurve: 'P-256'},
      false,
      ['verify'],
    );
  } catch {
    fail('invalid_server_public_key');
  }
  if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) fail('invalid_server_fingerprint');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', der);
  if (`sha256:${bytesToHex(digest)}` !== fingerprint) fail('fingerprint_mismatch');
  return der;
}

function normalizeNow(now) {
  if (now === undefined) return Date.now();
  if (typeof now === 'string') return parseUtcSeconds(now, 'validator_time');
  if (now instanceof Date) {
    const ms = now.getTime();
    if (!Number.isFinite(ms)) fail('invalid_validator_time');
    return ms;
  }
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  fail('invalid_validator_time');
}

export async function decodeBundle(value, options = {}) {
  if (typeof value !== 'string') throw new TypeError('bundle_must_be_str');
  if (!value || value.length > BUNDLE_MAX_LENGTH || /[\r\n]/.test(value) || /\s/.test(value)) fail('invalid_bundle');

  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== BUNDLE_VERSION) fail('invalid_bundle');
  const payloadBytes = b64uDecode(parts[1], 'payload');
  const checksumBytes = b64uDecode(parts[2], 'checksum');
  if (!payloadBytes.length) fail('invalid_payload');
  if (checksumBytes.length !== 32 || parts[2].length !== 43) fail('invalid_checksum');

  const domain = new Uint8Array(6 + payloadBytes.length);
  domain.set(te.encode('BB2D1\0'), 0);
  domain.set(payloadBytes, 6);
  const expectedChecksum = await globalThis.crypto.subtle.digest('SHA-256', domain);
  if (!equalBytes(checksumBytes, expectedChecksum)) fail('checksum_mismatch');

  let payloadText;
  let parsed;
  try {
    payloadText = fatalUtf8.decode(payloadBytes);
    parsed = JSON.parse(payloadText);
  } catch {
    fail('invalid_payload');
  }
  const normalized = canonicalPayloadObject(parsed);
  if (normalized.bundle_version !== BUNDLE_VERSION) fail('invalid_bundle_version');

  const issuedMs = parseUtcSeconds(normalized.issued_at, 'issued_at');
  const expiresMs = parseUtcSeconds(normalized.expires_at, 'expires_at');
  const ttlMs = expiresMs - issuedMs;
  if (ttlMs <= 0) fail('invalid_expiry');
  if (ttlMs % 1000 !== 0 || ttlMs < 300000 || ttlMs > 600000) fail('invalid_ttl');

  validateIpv4(normalized.host);
  if (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) fail('invalid_port');
  validateUuid4(normalized.instance_id, 'instance_id');
  validateUuid4(normalized.pairing_session_id, 'pairing_session_id');
  if (typeof normalized.pairing_code !== 'string' || !HEX32.test(normalized.pairing_code)) fail('invalid_pairing_code');
  if (!Number.isInteger(normalized.rotation_generation) || normalized.rotation_generation < 1) fail('invalid_rotation_generation');
  if (normalized.server_signing_algorithm !== SERVER_SIGNING_ALGORITHM) fail('invalid_server_signing_algorithm');
  if (normalized.server_public_key_format !== SERVER_PUBLIC_KEY_FORMAT) fail('invalid_server_public_key_format');
  await validateServerPublicKey(normalized.server_public_key, normalized.server_fingerprint);

  const canonicalBytes = canonicalPayloadBytes(normalized);
  if (!equalBytes(canonicalBytes, payloadBytes)) fail('noncanonical_payload');

  if (expiresMs <= normalizeNow(options.now)) fail('expired_bundle');
  return Object.freeze({...normalized});
}

export const __test = Object.freeze({b64uDecode, canonicalPayloadBytes, parseUtcSeconds, validateIpv4});
