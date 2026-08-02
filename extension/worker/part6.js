async function handleContentReady(message, sender) {
  const tab = sender?.tab;
  const here = message.identity || null;
  if (!tab?.id || !here?.conversation_id) return { ok: true, matched: false };
  const key = BB2Protocol.conversationKey(here);
  const candidates = (await listRuns()).filter((run) =>
    run.conversation_key === key && ![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status)
  );
  if (!candidates.length) return { ok: true, matched: false };
  if (candidates.length > 1) {
    await diagnostic("CONTENT_READY_AMBIGUOUS_RUNS", { conversation_key: key, run_ids: candidates.map((run) => run.run_id) });
    return { ok: false, error: "Multiple active runs for the same conversation." };
  }
  let run = candidates[0];
  if (run.tab_id !== tab.id) {
    const oldTab = await chrome.tabs.get(run.tab_id).catch(() => null);
    let oldTabOwnsConversation = false;
    if (oldTab) {
      const oldIdentity = await tabIdentity(run.tab_id).catch(() => null);
      oldTabOwnsConversation = oldIdentity?.conversation_id === run.conversation_id;
    }
    if (oldTabOwnsConversation) {
      await diagnostic("CONTENT_READY_NONOWNER_DUPLICATE_TAB", { run_id: run.run_id, owner_tab_id: run.tab_id, candidate_tab_id: tab.id });
      return { ok: true, matched: true, owner: false, run_id: run.run_id };
    }
    run = BB2Model.evolveRun(run, { tab_id: tab.id, window_id: tab.windowId });
    await saveRun(run);
    await diagnostic("RUN_TAB_REBOUND_AFTER_OLD_TAB_GONE", { run_id: run.run_id, tab_id: tab.id, window_id: tab.windowId });
  }
  if (run.status === BB2Model.RUN_STATUSES.WAITING_PROMPT) {
    await beginPromptWatch(run);
  } else if (run.status === BB2Model.RUN_STATUSES.PAUSED) {
    await showRunStatus(run, "Business Bridge 2: run на паузе.", "operator_work");
  } else {
    schedulePoll(run.run_id, 250);
  }
  return { ok: true, matched: true, owner: true, run_id: run.run_id, status: run.status };
}


const DIRECT_UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireTrustedExtensionSender(sender) {
  if (sender?.tab) {
    const error = new Error("Direct profile management is available only from trusted extension UI.");
    error.code = "DIRECT_TRUSTED_UI_REQUIRED";
    throw error;
  }
}

async function getDirectProfilesAndKeys() {
  const data = await storageGet([KEYS.DIRECT_PROFILES, KEYS.DIRECT_PRIVATE_KEYS]);
  return {
    profiles: data[KEYS.DIRECT_PROFILES] || {},
    privateKeys: data[KEYS.DIRECT_PRIVATE_KEYS] || {}
  };
}

async function directProfilesForPopup() {
  const { profiles, privateKeys } = await getDirectProfilesAndKeys();
  return Object.values(profiles)
    .map((profile) => BB2Direct.publicProfile(profile, Boolean(profile.key_ref && privateKeys[profile.key_ref]?.pkcs8)))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function validateDirectPairingResponse(payload, bundle) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Direct pairing returned malformed JSON.");
  if (payload.pairing_version !== "1" || payload.status !== "ACTIVE") throw new Error("Direct pairing response has an unsupported status.");
  if (!DIRECT_UUID4.test(String(payload.device_id || ""))) throw new Error("Direct pairing response has an invalid device_id.");
  if (payload.instance_id !== bundle.instance_id) {
    const error = new Error("Direct server identity changed during pairing.");
    error.code = "DIRECT_SERVER_IDENTITY_CHANGED";
    throw error;
  }
  return payload;
}

async function directHttp(origin, path, body, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    const text = await response.text();
    if (text.length > 65536) throw new Error("Direct response exceeds safe limit.");
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; }
    catch (_) { throw new Error("Direct server returned malformed JSON."); }
    return { status: response.status, payload };
  } catch (sourceError) {
    const error = new Error(sourceError?.name === "AbortError" ? "Direct request timed out." : (sourceError?.message || "Direct network request failed."));
    error.code = sourceError?.name === "AbortError" ? "DIRECT_TIMEOUT" : "DIRECT_NETWORK_ERROR";
    throw error;
  } finally {
    clearTimeout(timer);
  }
}


async function directGet(origin, path, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "GET", headers: { Accept: "application/json" }, cache: "no-store",
      credentials: "omit", redirect: "error", signal: controller.signal
    });
    const text = await response.text();
    if (text.length > 65536) throw new Error("Direct response exceeds safe limit.");
    return { status: response.status, payload: text ? JSON.parse(text) : null };
  } finally {
    clearTimeout(timer);
  }
}

async function assertDirectAdvertisedIdentity(profile) {
  const origin = BB2Direct.directOrigin(profile.host, profile.port);
  let result;
  try { result = await directGet(origin, "/v2/bootstrap"); }
  catch (_) { return { available: false, matched: null }; }
  if (result.status !== 200 || !result.payload || typeof result.payload !== "object") return { available: false, matched: null };
  const advertised = result.payload;
  const matched = advertised.instance_id === profile.server_instance_id
    && advertised.server_fingerprint === profile.server_fingerprint
    && advertised.server_public_key === profile.server_public_key
    && Number(advertised.rotation_generation) === Number(profile.rotation_generation);
  if (!matched) {
    const error = new Error("Direct endpoint advertises a different pinned server identity. Connection is blocked.");
    error.code = "server_identity_changed";
    throw error;
  }
  return { available: true, matched: true };
}

async function updateDirectProfile(profileId, mutator) {
  return withStorageLock("direct_profiles", async () => {
    const data = await getDirectProfilesAndKeys();
    const current = data.profiles[profileId];
    if (!current) throw new Error("Direct profile not found.");
    const next = mutator({ ...current });
    data.profiles[profileId] = next;
    await storageSet({ [KEYS.DIRECT_PROFILES]: data.profiles });
    return next;
  });
}

async function directLifecycle(profileId, action, { connect = false } = {}) {
  const data = await getDirectProfilesAndKeys();
  const profile = data.profiles[profileId];
  if (!profile) throw new Error("Direct profile not found.");
  const keyEntry = profile.key_ref ? data.privateKeys[profile.key_ref] : null;
  if (!keyEntry?.pkcs8) {
    const error = new Error("Private device key is unavailable; re-pair this Direct profile.");
    error.code = "DIRECT_PRIVATE_KEY_MISSING";
    throw error;
  }
  try {
    await assertDirectAdvertisedIdentity(profile);
    const privateKey = await BB2Direct.importDevicePrivateKey(keyEntry.pkcs8);
    const request = await BB2Direct.lifecycleRequest(profile, privateKey, action);
    const origin = BB2Direct.directOrigin(profile.host, profile.port);
    const result = await directHttp(origin, "/v2/pairing/device", request);
    if (result.status !== 200) {
      const error = new Error(`Direct lifecycle rejected (${result.status}).`);
      error.code = "DIRECT_LIFECYCLE_REJECTED";
      throw error;
    }
    const verified = await BB2Direct.verifyLifecycleResponse(profile, request, result.payload, Date.now());
    const now = new Date().toISOString();
    const next = await updateDirectProfile(profileId, (current) => ({
      ...current,
      profile_revision: Number(current.profile_revision || 0) + 1,
      device_status: verified.status,
      connection_state: verified.status === "REVOKED" ? "REVOKED" : (connect ? "CONNECTED" : (current.connection_state || "DISCONNECTED")),
      identity_warning: null,
      last_verified_at: now,
      revoked_at: verified.status === "REVOKED" ? (current.revoked_at || now) : null,
      updated_at: now
    }));
    await diagnostic("DIRECT_LIFECYCLE_VERIFIED", { profile_id: profileId, action, device_status: verified.status, connection_state: next.connection_state });
    return BB2Direct.publicProfile(next, true);
  } catch (error) {
    if (["server_identity_changed", "invalid_server_signature", "lifecycle_response_mismatch"].includes(error?.code)) {
      await updateDirectProfile(profileId, (current) => ({
        ...current,
        profile_revision: Number(current.profile_revision || 0) + 1,
        connection_state: "IDENTITY_WARNING",
        identity_warning: "Pinned server identity verification failed. Connection is blocked.",
        updated_at: new Date().toISOString()
      })).catch(() => null);
    }
    await diagnostic("DIRECT_LIFECYCLE_FAILED", { profile_id: profileId, action, code: error?.code || "DIRECT_ERROR", error: error?.message }, { level: "warning" });
    throw error;
  }
}

async function pairDirectProfile(message) {
  const bundle = BB2Direct.normalizeBundlePayload(message.bundle);
  if (Date.parse(bundle.expires_at) <= Date.now()) {
    const error = new Error("Connection bundle expired.");
    error.code = "DIRECT_BUNDLE_EXPIRED";
    throw error;
  }
  const origin = BB2Direct.directOrigin(bundle.host, bundle.port);
  const device = await BB2Direct.generateDeviceIdentity();
  const request = BB2Direct.pairingRequest(bundle, device.public_key);
  const result = await directHttp(origin, "/v2/pairing/complete", request);
  if (result.status !== 201) {
    const error = new Error(`Direct pairing rejected (${result.status}).`);
    error.code = "DIRECT_PAIRING_REJECTED";
    throw error;
  }
  const paired = validateDirectPairingResponse(result.payload, bundle);
  const profileId = uuid("direct-profile");
  const keyRef = uuid("direct-key");
  const now = new Date().toISOString();
  const profile = {
    profile_id: profileId,
    kind: "direct",
    profile_revision: 1,
    name: String(message.name || `Direct ${bundle.host}`).trim().slice(0, 80) || `Direct ${bundle.host}`,
    host: bundle.host,
    port: bundle.port,
    server_instance_id: bundle.instance_id,
    server_fingerprint: bundle.server_fingerprint,
    server_public_key: bundle.server_public_key,
    server_public_key_format: bundle.server_public_key_format,
    server_signing_algorithm: bundle.server_signing_algorithm,
    rotation_generation: bundle.rotation_generation,
    device_id: paired.device_id,
    device_fingerprint: paired.device_fingerprint || "",
    device_public_key: device.public_key,
    key_ref: keyRef,
    device_status: "ACTIVE",
    connection_state: "VERIFYING",
    identity_warning: null,
    created_at: now,
    updated_at: now,
    last_verified_at: null,
    revoked_at: null
  };
  await withStorageLock("direct_profiles", async () => {
    const data = await getDirectProfilesAndKeys();
    data.profiles[profileId] = profile;
    data.privateKeys[keyRef] = { pkcs8: device.private_key, created_at: now };
    await storageSet({
      [KEYS.DIRECT_PROFILES]: data.profiles,
      [KEYS.DIRECT_PRIVATE_KEYS]: data.privateKeys
    });
  });
  await diagnostic("DIRECT_PROFILE_PAIRED", { profile_id: profileId, host: bundle.host, port: bundle.port, server_instance_id: bundle.instance_id, server_fingerprint: bundle.server_fingerprint });
  try {
    return await directLifecycle(profileId, "status", { connect: true });
  } catch (error) {
    if (!["server_identity_changed", "invalid_server_signature", "lifecycle_response_mismatch"].includes(error?.code)) {
      await updateDirectProfile(profileId, (current) => ({ ...current, connection_state: "ERROR", updated_at: new Date().toISOString() })).catch(() => null);
    }
    error.profile_id = profileId;
    throw error;
  }
}

async function renameDirectProfile(profileId, name) {
  const normalized = String(name || "").trim();
  if (!normalized) throw new Error("Direct profile name is required.");
  const next = await updateDirectProfile(profileId, (current) => ({
    ...current,
    name: normalized.slice(0, 80),
    profile_revision: Number(current.profile_revision || 0) + 1,
    updated_at: new Date().toISOString()
  }));
  await diagnostic("DIRECT_PROFILE_RENAMED", { profile_id: profileId });
  const { privateKeys } = await getDirectProfilesAndKeys();
  return BB2Direct.publicProfile(next, Boolean(next.key_ref && privateKeys[next.key_ref]?.pkcs8));
}

async function disconnectDirectProfile(profileId) {
  const next = await updateDirectProfile(profileId, (current) => ({
    ...current,
    connection_state: current.device_status === "REVOKED" ? "REVOKED" : "DISCONNECTED",
    profile_revision: Number(current.profile_revision || 0) + 1,
    updated_at: new Date().toISOString()
  }));
  await diagnostic("DIRECT_PROFILE_DISCONNECTED", { profile_id: profileId });
  const { privateKeys } = await getDirectProfilesAndKeys();
  return BB2Direct.publicProfile(next, Boolean(next.key_ref && privateKeys[next.key_ref]?.pkcs8));
}

async function deleteDirectProfile(profileId, force) {
  return withStorageLock("direct_profiles", async () => {
    const data = await getDirectProfilesAndKeys();
    const profile = data.profiles[profileId];
    if (!profile) throw new Error("Direct profile not found.");
    if (profile.device_status === "ACTIVE" && force !== true) {
      const error = new Error("Direct device is still ACTIVE. Revoke it first or explicitly confirm local-only deletion.");
      error.code = "DIRECT_ACTIVE_DELETE_CONFIRMATION_REQUIRED";
      throw error;
    }
    delete data.profiles[profileId];
    if (profile.key_ref) delete data.privateKeys[profile.key_ref];
    await storageSet({ [KEYS.DIRECT_PROFILES]: data.profiles, [KEYS.DIRECT_PRIVATE_KEYS]: data.privateKeys });
    await diagnostic("DIRECT_PROFILE_DELETED", { profile_id: profileId, remote_status_at_delete: profile.device_status, local_only: true });
    return { profile_id: profileId, remote_status_at_delete: profile.device_status };
  });
}

function exportedDirectProfiles(value) {
  const out = {};
  for (const [id, raw] of Object.entries(value || {})) {
    const profile = { ...raw };
    delete profile.key_ref;
    out[id] = profile;
  }
  return out;
}

function validateImportedDirectProfile(raw, id) {
  if (!raw || typeof raw !== "object") throw new Error("Backup contains a damaged Direct profile.");
  const profileId = String(raw.profile_id || id || "");
  if (!/^direct-profile-[0-9a-f-]{20,}$/i.test(profileId)) throw new Error(`Invalid Direct profile_id: ${profileId || "empty"}.`);
  const profile = {
    ...raw,
    profile_id: profileId,
    kind: "direct",
    name: String(raw.name || `Direct ${raw.host || "server"}`).slice(0, 80),
    host: String(raw.host || ""),
    port: Number(raw.port),
    server_instance_id: String(raw.server_instance_id || ""),
    server_fingerprint: String(raw.server_fingerprint || ""),
    server_public_key: String(raw.server_public_key || ""),
    rotation_generation: Number(raw.rotation_generation || 0),
    device_id: String(raw.device_id || ""),
    key_ref: null,
    connection_state: "NEEDS_REPAIR",
    identity_warning: "Private device key is intentionally excluded from backups; re-pair this profile before use.",
    updated_at: new Date().toISOString()
  };
  BB2Direct.directOrigin(profile.host, profile.port);
  BB2Direct.normalizeBundlePayload({
    bundle_version: "BB2D1",
    issued_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-01-01T00:05:00Z",
    host: profile.host,
    port: profile.port,
    instance_id: profile.server_instance_id,
    pairing_session_id: "00000000-0000-4000-8000-000000000001",
    pairing_code: "00000000000000000000000000000000",
    rotation_generation: profile.rotation_generation,
    server_fingerprint: profile.server_fingerprint,
    server_public_key: profile.server_public_key,
    server_public_key_format: raw.server_public_key_format || "SPKI_DER_BASE64URL",
    server_signing_algorithm: raw.server_signing_algorithm || "ECDSA_P256_SHA256"
  });
  if (!DIRECT_UUID4.test(profile.device_id)) throw new Error(`Invalid Direct device_id for ${profileId}.`);
  return profile;
}
