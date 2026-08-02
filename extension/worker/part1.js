/* global BB2Protocol, BB2Model, BB2Transport */
importScripts("shared/protocol.js", "shared/model.js", "shared/manual_controls.js", "shared/transport.js", "shared/direct_profiles.js");

"use strict";

const KEYS = Object.freeze({
  CLIENT_ID: "bb2_client_installation_id",
  PROFILES: "bb2_profiles",
  CREDENTIALS: "bb2_credentials",
  DEFAULT_PROFILE: "bb2_default_profile_id",
  BINDINGS: "bb2_conversation_bindings",
  PENDING_BINDINGS: "bb2_pending_bindings",
  RUN_INDEX: "bb2_run_index",
  DIAGNOSTICS: "bb2_diagnostics",
  SEND_BUTTON_PROFILE: "bb2_send_button_profile",
  COPY_BUTTON_PROFILE: "bb2_copy_button_profile",
  COPY_BUTTON_PROFILES: "bb2_copy_button_profiles",
  EXECUTOR_CATALOGS: "bb2_executor_catalogs",
  NEXT_ITERATION_CONFIGS: "bb2_next_iteration_configs",
  FOCUS_POLICIES: "bb2_focus_policies",
  RESOURCE_POLICIES: "bb2_resource_recovery_policies",
  REPORT_ATTACHMENTS: "bb2_report_attachment_configs",
  REPORT_PREFIXES: "bb2_report_prefix_configs",
  SETTINGS_SCHEMA: "bb2_settings_schema_version",
  DIAGNOSTIC_SEQ: "bb2_diagnostic_sequence",
  MIGRATION_BACKUP: "bb2_last_settings_migration_backup",
  TRANSPORT_STATES: "bb2_transport_states",
  MANUAL_MODES: "bb2_manual_modes",
  DIRECT_PROFILES: "bb2_direct_profiles",
  DIRECT_PRIVATE_KEYS: "bb2_direct_private_keys"
});
const RUN_PREFIX = "bb2_run:";
const POLL_ALARM = "bb2_recovery_poll";
const RUNTIME_VERSION = "2.0.0.21";
const SETTINGS_SCHEMA_VERSION = 5;
const MAX_DIAGNOSTICS = 1500;
const HTTP_TIMEOUT_MS = 10000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const DELIVERY_RESPONSE_LIMIT_BYTES = 12 * 1024 * 1024;
const SETTINGS_BACKUP_VERSION = 5;
const MAX_CONTEXT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const runLocks = new Map();
const storageLocks = new Map();
const pollTimers = new Map();
const executorCatalogRequests = new Map();
const executorRefreshRequests = new Map();
const runCycleRequests = new Map();
const deliveryAttemptRequests = new Map();
const transportMemo = new Map();

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value || {});
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function uuid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function copyButtonProfileCollection(value) {
  return BB2ManualControls.normalizeCopyButtonProfileCollection(value);
}

function copyButtonProfileWithMetadata(profile) {
  const normalized = BB2ManualControls.normalizeCopyButtonProfile(profile);
  if (!normalized) return null;
  return {
    ...normalized,
    profile_id: normalized.profile_id || uuid("copy-profile"),
    created_at: normalized.created_at || new Date().toISOString()
  };
}

function rawCopyButtonProfileEntries(value) {
  if (value?.kind === "bb2_manual_copy_profiles_v2") return Array.isArray(value.profiles) ? value.profiles : [];
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? [value] : [];
}

function mergeCopyButtonProfileCollectionsWithoutLoss(current, incoming) {
  const profiles = [];
  const seen = new Set();
  for (const raw of [...rawCopyButtonProfileEntries(current), ...rawCopyButtonProfileEntries(incoming)]) {
    const profile = copyButtonProfileWithMetadata(raw);
    if (!profile) continue;
    const key = BB2ManualControls.copyButtonProfileKey(profile);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    profiles.push(profile);
    if (profiles.length > BB2ManualControls.MAX_CUSTOM_COPY_BUTTON_PROFILES) {
      throw new Error(`Backup содержит больше ${BB2ManualControls.MAX_CUSTOM_COPY_BUTTON_PROFILES} уникальных пользовательских Copy-профилей.`);
    }
  }
  return copyButtonProfileCollection({ kind: "bb2_manual_copy_profiles_v2", profiles });
}

function legacyCompatibleCopyButtonProfile(collection) {
  const profiles = copyButtonProfileCollection(collection).profiles;
  const legacy = [...profiles].reverse().find((profile) => (
    profile.adapter_id === BB2ManualControls.MANUAL_COPY_ADAPTER_IDS.LEGACY_CODE_BLOCK
  ));
  if (!legacy) return null;
  return {
    kind: "bb2_manual_copy_button_v1",
    tag: legacy.tag,
    testid: legacy.testid,
    aria: legacy.aria,
    title: legacy.title,
    name: legacy.name,
    type: legacy.type,
    text_hint: legacy.text_hint,
    requires_code_block_viewer: true
  };
}

async function getCopyButtonProfiles({ persistMigration = true } = {}) {
  const data = await storageGet([KEYS.COPY_BUTTON_PROFILES, KEYS.COPY_BUTTON_PROFILE]);
  const storedCollection = data[KEYS.COPY_BUTTON_PROFILES];
  const source = storedCollection || data[KEYS.COPY_BUTTON_PROFILE] || null;
  const collection = copyButtonProfileCollection(source);
  if (persistMigration && !storedCollection && collection.profiles.length > 0) {
    await storageSet({ [KEYS.COPY_BUTTON_PROFILES]: collection });
  }
  return collection;
}

async function appendCopyButtonProfile(profile) {
  const normalized = copyButtonProfileWithMetadata(profile);
  if (!normalized) throw new Error("Invalid Copy button profile.");
  return withStorageLock("copy_button_profiles", async () => {
    const current = await getCopyButtonProfiles({ persistMigration: false });
    const currentKeys = new Set(current.profiles.map(BB2ManualControls.copyButtonProfileKey));
    const key = BB2ManualControls.copyButtonProfileKey(normalized);
    const profiles = currentKeys.has(key) ? current.profiles : [...current.profiles, normalized];
    if (profiles.length > BB2ManualControls.MAX_CUSTOM_COPY_BUTTON_PROFILES) {
      throw new Error(`Достигнут безопасный предел ${BB2ManualControls.MAX_CUSTOM_COPY_BUTTON_PROFILES} пользовательских Copy-профилей.`);
    }
    const collection = copyButtonProfileCollection({ kind: "bb2_manual_copy_profiles_v2", profiles });
    await storageSet({
      [KEYS.COPY_BUTTON_PROFILES]: collection,
      [KEYS.COPY_BUTTON_PROFILE]: legacyCompatibleCopyButtonProfile(collection)
    });
    return collection;
  });
}

async function broadcastCopyButtonProfiles(collection) {
  const normalized = copyButtonProfileCollection(collection);
  const legacy = legacyCompatibleCopyButtonProfile(normalized);
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  await Promise.all(tabs.flatMap((tab) => {
    if (!tab.id) return [];
    return [
      tabMessage(tab.id, { type: "BB2_SET_COPY_BUTTON_PROFILE", profile: legacy }, 1500).catch(() => null),
      tabMessage(tab.id, { type: "BB2_SET_COPY_BUTTON_PROFILES", profiles: normalized }, 1500).catch(() => null)
    ];
  }));
}

function sanitizeDiagnosticValue(value, key = "", depth = 0) {
  const lower = String(key || "").toLowerCase();
  if (["token", "authorization", "prompt_text", "report_text", "body", "credential", "pairing_code", "private_key", "pkcs8"].includes(lower) || lower.includes("token") || lower.includes("secret") || lower.includes("private")) {
    return undefined;
  }
  if (depth > 4) return "[depth-limited]";
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (value === null || ["number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDiagnosticValue(item, "", depth + 1)).filter((item) => item !== undefined);
  if (typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const safe = sanitizeDiagnosticValue(childValue, childKey, depth + 1);
      if (safe !== undefined) result[childKey] = safe;
    }
    return result;
  }
  return String(value);
}

function safeDiagnosticDetails(details = {}) {
  return sanitizeDiagnosticValue(details, "", 0) || {};
}

async function diagnostic(event, details = {}, options = {}) {
  try {
    return await withStorageLock("diagnostics", async () => {
      const current = await storageGet([KEYS.DIAGNOSTICS, KEYS.DIAGNOSTIC_SEQ]);
      const list = Array.isArray(current[KEYS.DIAGNOSTICS]) ? current[KEYS.DIAGNOSTICS] : [];
      const sequence = Math.max(0, Number(current[KEYS.DIAGNOSTIC_SEQ] || 0)) + 1;
      const safe = safeDiagnosticDetails(details);
      const record = {
        sequence,
        event_id: `event-${sequence}-${crypto.randomUUID()}`,
        at: new Date().toISOString(),
        runtime_version: RUNTIME_VERSION,
        source: String(options.source || safe.source || "service_worker"),
        level: String(options.level || safe.level || "info"),
        event: String(event || "UNKNOWN_EVENT"),
        ...safe
      };
      delete record.source_detail;
      list.push(record);
      await storageSet({
        [KEYS.DIAGNOSTICS]: list.slice(-MAX_DIAGNOSTICS),
        [KEYS.DIAGNOSTIC_SEQ]: sequence
      });
      return record;
    });
  } catch (_) {
    return null;
  }
}

async function clientId() {
  return withStorageLock("client_id", async () => {
    const current = await storageGet(KEYS.CLIENT_ID);
    if (current[KEYS.CLIENT_ID]) return current[KEYS.CLIENT_ID];
    const value = uuid("client");
    await storageSet({ [KEYS.CLIENT_ID]: value });
    return value;
  });
}

async function getProfilesAndCredentials() {
  const data = await storageGet([KEYS.PROFILES, KEYS.CREDENTIALS, KEYS.DEFAULT_PROFILE]);
  return {
    profiles: data[KEYS.PROFILES] || {},
    credentials: data[KEYS.CREDENTIALS] || {},
    defaultProfileId: data[KEYS.DEFAULT_PROFILE] || null
  };
}

async function getBindings() {
  const data = await storageGet([KEYS.BINDINGS, KEYS.PENDING_BINDINGS]);
  return { bindings: data[KEYS.BINDINGS] || {}, pending: data[KEYS.PENDING_BINDINGS] || {} };
}


function conversationSettingsKey(identity, tabId) {
  return BB2Protocol.conversationKey(identity) || `pending-tab:${String(tabId)}`;
}

async function getManualModeForContext(identity, tabId) {
  const key = conversationSettingsKey(identity, tabId);
  const data = await storageGet(KEYS.MANUAL_MODES);
  const modes = data[KEYS.MANUAL_MODES] || {};
  return modes[key] === true;
}

async function setManualModeForContext(identity, tabId, enabled) {
  const key = conversationSettingsKey(identity, tabId);
  return withStorageLock("manual_modes", async () => {
    const data = await storageGet(KEYS.MANUAL_MODES);
    const modes = data[KEYS.MANUAL_MODES] || {};
    if (enabled === true) modes[key] = true;
    else delete modes[key];
    await storageSet({ [KEYS.MANUAL_MODES]: modes });
    return { key, enabled: enabled === true };
  });
}

function defaultNextIterationConfig(executorId = null) {
  return {
    executor_id: executorId || null,
    focus_policy: "report_only",
    wait_for_selected_executor: true,
    updated_at: null
  };
}

async function getConversationSettings(identity, tabId) {
  const key = conversationSettingsKey(identity, tabId);
  const data = await storageGet([
    KEYS.NEXT_ITERATION_CONFIGS,
    KEYS.FOCUS_POLICIES,
    KEYS.RESOURCE_POLICIES,
    KEYS.REPORT_ATTACHMENTS,
    KEYS.REPORT_PREFIXES
  ]);
  const nextConfigs = data[KEYS.NEXT_ITERATION_CONFIGS] || {};
  const focusPolicies = data[KEYS.FOCUS_POLICIES] || {};
  const resourcePolicies = data[KEYS.RESOURCE_POLICIES] || {};
  const attachments = data[KEYS.REPORT_ATTACHMENTS] || {};
  const prefixes = data[KEYS.REPORT_PREFIXES] || {};
  const next = {
    ...defaultNextIterationConfig(),
    ...(nextConfigs[key] || {})
  };
  if (focusPolicies[key]) next.focus_policy = focusPolicies[key];
  if (Object.prototype.hasOwnProperty.call(resourcePolicies, key)) {
    next.wait_for_selected_executor = resourcePolicies[key] !== false;
  }
  return {
    key,
    next,
    attachment: attachments[key] || null,
    report_prefix: prefixes[key] || null
  };
}
