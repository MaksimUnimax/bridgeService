async function migrateDirectProfilesV5() {
  const data = await storageGet([KEYS.DIRECT_PROFILES, KEYS.DIRECT_PRIVATE_KEYS]);
  const updates = {};
  if (!data[KEYS.DIRECT_PROFILES]) updates[KEYS.DIRECT_PROFILES] = {};
  if (!data[KEYS.DIRECT_PRIVATE_KEYS]) updates[KEYS.DIRECT_PRIVATE_KEYS] = {};
  if (Object.keys(updates).length) await storageSet(updates);
  return { migrated: Object.keys(updates).length > 0 };
}

async function getPopupState() {
  const tab = await activeChatTab();
  const identity = await tabIdentity(tab.id);
  const { profiles, defaultProfileId } = await getProfilesAndCredentials();
  const { bindings, pending } = await getBindings();
  const key = BB2Protocol.conversationKey(identity);
  const boundProfileId = key ? bindings[key] || null : pending[String(tab.id)] || null;
  const allRuns = await listRuns();
  const activeRuns = allRuns.filter((run) => ![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status));
  const latestRun = [...allRuns].sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0))[0] || null;
  const activeRun = activeRuns.find((run) => (
    (key && run.conversation_key === key) || (!key && run.tab_id === tab.id && !run.conversation_id)
  )) || null;
  const settings = await getConversationSettings(identity, tab.id);
  const manualMode = await getManualModeForContext(identity, tab.id);
  const manualButtonState = await manualButtonStateForContext(identity, tab.id);
  const buttonProfileData = await storageGet([KEYS.SEND_BUTTON_PROFILE]);
  const copyButtonProfiles = await getCopyButtonProfiles();
  const pageMonitor = await tabMessage(tab.id, { type: "BB2_PING" }, 3000).catch((error) => ({ ok: false, error: error.message }));
  const visibleProfileId = activeRun?.profile_snapshot?.profile_id || boundProfileId || defaultProfileId || Object.keys(profiles)[0] || null;
  const transport = visibleProfileId ? BB2Transport.publicState(await transportStateForProfile(visibleProfileId)) : BB2Transport.publicState(BB2Transport.initial());
  const directProfiles = await directProfilesForPopup();
  const publicRun = (run) => ({
    run_id: run.run_id,
    status: run.status,
    executor_id: run.executor_id,
    current_job_id: run.current_job_id,
    last_job_id: run.last_job_id || null,
    current_server: publicProfile(run.profile_snapshot),
    sequence: run.sequence,
    chain_sequence: Number(run.chain_sequence ?? run.sequence ?? 0),
    focus_policy: run.focus_policy || "report_only",
    wait_for_selected_executor: run.wait_for_selected_executor !== false,
    pause_requested: run.pause_requested === true,
    pause_reason: run.pause_reason || null,
    submission_origin: run.submission_origin || null,
    manual_one_shot: run.manual_one_shot === true,
    error: run.error
  });
  const attachment = settings.attachment ? {
    file_name: settings.attachment.file_name,
    mime_type: settings.attachment.mime_type,
    size_bytes: settings.attachment.size_bytes,
    interval: settings.attachment.interval,
    delivered_count: settings.attachment.delivered_count || 0,
    last_attached_at_count: settings.attachment.last_attached_at_count || 0,
    updated_at: settings.attachment.updated_at || null
  } : null;
  const reportPrefix = settings.report_prefix ? {
    enabled: settings.report_prefix.enabled === true,
    text: String(settings.report_prefix.text || ""),
    interval: settings.report_prefix.interval || 1,
    delivered_count: settings.report_prefix.delivered_count || 0,
    last_applied_at_count: settings.report_prefix.last_applied_at_count || 0,
    updated_at: settings.report_prefix.updated_at || null
  } : null;
  return {
    tab: { id: tab.id, window_id: tab.windowId, title: tab.title || "" },
    identity,
    profiles: Object.values(profiles).map(publicProfile),
    direct_profiles: directProfiles,
    default_profile_id: defaultProfileId,
    bound_profile_id: boundProfileId,
    active_run_count: activeRuns.length,
    active_runs: activeRuns.map(publicRun),
    active_run: activeRun ? publicRun(activeRun) : null,
    next_iteration_config: settings.next,
    report_attachment: attachment,
    report_prefix: reportPrefix,
    manual_mode: manualMode,
    manual_button_state: manualButtonState,
    send_button_profile: buttonProfileData[KEYS.SEND_BUTTON_PROFILE] || null,
    copy_button_profile: legacyCompatibleCopyButtonProfile(copyButtonProfiles),
    copy_button_profiles: copyButtonProfiles,
    copy_button_profile_count: copyButtonProfiles.profiles.length,
    copy_button_builtin_adapter_count: BB2ManualControls.BUILTIN_MANUAL_COPY_ADAPTER_COUNT,
    visible_profile_id: visibleProfileId,
    transport,
    page_monitor: pageMonitor,
    latest_task_id: latestRun?.current_job_id || latestRun?.last_job_id || null
  };
}

async function addOrUpdateProfile(message) {
  const endpoint = BB2Protocol.normalizedEndpoint(message.endpoint);
  const tokenInput = String(message.token || "").trim();
  const initial = await getProfilesAndCredentials();
  const initialExisting = message.profile_id ? initial.profiles[message.profile_id] : null;
  let token = tokenInput;
  if (!token && initialExisting) token = initial.credentials[initialExisting.credential_ref] || "";
  if (!token) throw new Error("Token обязателен для нового профиля.");

  const probe = { endpoint };
  const bridgeIdentity = await validateProfile(probe, token);
  const profile = await withStorageLock("profiles", async () => {
    const data = await getProfilesAndCredentials();
    const existing = message.profile_id ? data.profiles[message.profile_id] : null;
    if (message.profile_id && !existing) throw new Error("Редактируемый Bridge-профиль больше не существует.");
    if (existing && existing.bridge_instance_id !== bridgeIdentity.instance_id) {
      throw new Error("Endpoint теперь отвечает другим bridge_instance_id. Создай отдельный профиль вместо скрытой подмены сервера.");
    }
    const profileId = existing?.profile_id || uuid("profile");
    const credentialRef = uuid("credential");
    const now = new Date().toISOString();
    const nextProfile = {
      profile_id: profileId,
      profile_revision: Number(existing?.profile_revision || 0) + 1,
      name: String(message.name || existing?.name || `Bridge ${bridgeIdentity.instance_id.slice(0, 8)}`).trim(),
      endpoint,
      credential_ref: credentialRef,
      bridge_instance_id: bridgeIdentity.instance_id,
      api_contract: bridgeIdentity.api_contract,
      deployment_revision: bridgeIdentity.deployment_revision || "",
      created_at: existing?.created_at || now,
      updated_at: now
    };
    data.profiles[profileId] = nextProfile;
    data.credentials[credentialRef] = token;
    const defaultProfileId = data.defaultProfileId || profileId;
    await storageSet({
      [KEYS.PROFILES]: data.profiles,
      [KEYS.CREDENTIALS]: data.credentials,
      [KEYS.DEFAULT_PROFILE]: message.make_default ? profileId : defaultProfileId
    });
    return nextProfile;
  });
  const removedCredentials = await garbageCollectCredentials();
  await diagnostic("PROFILE_SAVED", { profile_id: profile.profile_id, endpoint, bridge_instance_id: profile.bridge_instance_id, revision: profile.profile_revision, removed_credentials: removedCredentials });
  return publicProfile(profile);
}

async function garbageCollectCredentials() {
  return withStorageLock("profiles", async () => {
    const data = await getProfilesAndCredentials();
    const runs = await listRuns();
    const referenced = new Set();
    for (const profile of Object.values(data.profiles)) {
      if (profile.credential_ref) referenced.add(profile.credential_ref);
    }
    for (const run of runs) {
      if (run.profile_snapshot?.credential_ref && ![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status)) {
        referenced.add(run.profile_snapshot.credential_ref);
      }
    }
    const next = {};
    for (const [ref, token] of Object.entries(data.credentials)) {
      if (referenced.has(ref)) next[ref] = token;
    }
    await storageSet({ [KEYS.CREDENTIALS]: next });
    return Object.keys(data.credentials).length - Object.keys(next).length;
  });
}


function exportedSettingsKeys() {
  return [
    KEYS.PROFILES,
    KEYS.CREDENTIALS,
    KEYS.DEFAULT_PROFILE,
    KEYS.BINDINGS,
    KEYS.PENDING_BINDINGS,
    KEYS.SEND_BUTTON_PROFILE,
    KEYS.COPY_BUTTON_PROFILE,
    KEYS.COPY_BUTTON_PROFILES,
    KEYS.NEXT_ITERATION_CONFIGS,
    KEYS.FOCUS_POLICIES,
    KEYS.RESOURCE_POLICIES,
    KEYS.REPORT_ATTACHMENTS,
    KEYS.REPORT_PREFIXES,
    KEYS.MANUAL_MODES,
    KEYS.DIRECT_PROFILES
  ];
}

function canonicalBackupValue(value) {
  if (Array.isArray(value)) return value.map(canonicalBackupValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalBackupValue(value[key])]));
  }
  return value;
}

async function exportSettingsBackup() {
  const data = await storageGet(exportedSettingsKeys());
  const profiles = data[KEYS.PROFILES] || {};
  const directProfiles = exportedDirectProfiles(data[KEYS.DIRECT_PROFILES] || {});
  const copyButtonProfiles = copyButtonProfileCollection(data[KEYS.COPY_BUTTON_PROFILES] || data[KEYS.COPY_BUTTON_PROFILE] || null);
  const settings = {
    profiles,
    direct_profiles: directProfiles,
    credentials: data[KEYS.CREDENTIALS] || {},
    default_profile_id: data[KEYS.DEFAULT_PROFILE] || null,
    bindings: data[KEYS.BINDINGS] || {},
    pending_bindings: data[KEYS.PENDING_BINDINGS] || {},
    send_button_profile: data[KEYS.SEND_BUTTON_PROFILE] || null,
    copy_button_profile: legacyCompatibleCopyButtonProfile(copyButtonProfiles),
    copy_button_profiles: copyButtonProfiles,
    next_iteration_configs: data[KEYS.NEXT_ITERATION_CONFIGS] || {},
    focus_policies: data[KEYS.FOCUS_POLICIES] || {},
    resource_policies: data[KEYS.RESOURCE_POLICIES] || {},
    report_attachments: data[KEYS.REPORT_ATTACHMENTS] || {},
    report_prefixes: data[KEYS.REPORT_PREFIXES] || {},
    manual_modes: data[KEYS.MANUAL_MODES] || {}
  };
  return {
    format: "business-bridge-2-settings-backup",
    backup_version: SETTINGS_BACKUP_VERSION,
    settings_schema_version: SETTINGS_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    extension_version: RUNTIME_VERSION,
    extension_id: chrome.runtime.id || null,
    contains_secrets: true,
    contains_direct_private_keys: false,
    profile_count: Object.keys(profiles).length,
    direct_profile_count: Object.keys(directProfiles).length,
    settings_sha256: await sha256Hex(JSON.stringify(canonicalBackupValue(settings))),
    settings
  };
}

function validateImportedProfile(profile, credentials) {
  if (!profile || typeof profile !== "object") throw new Error("Backup содержит повреждённый Bridge-профиль.");
  const profileId = String(profile.profile_id || "");
  if (!/^profile-[0-9a-f-]{20,}$/i.test(profileId)) throw new Error(`Некорректный profile_id: ${profileId || "empty"}.`);
  const endpoint = BB2Protocol.normalizedEndpoint(profile.endpoint);
  const credentialRef = String(profile.credential_ref || "");
  const token = String(credentials[credentialRef] || "").trim();
  if (!credentialRef || !token) throw new Error(`Для профиля ${profileId} отсутствует token.`);
  const instanceId = String(profile.bridge_instance_id || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instanceId)) {
    throw new Error(`Для профиля ${profileId} некорректный bridge_instance_id.`);
  }
  return {
    ...profile,
    profile_id: profileId,
    profile_revision: Math.max(1, Number(profile.profile_revision || 1)),
    name: String(profile.name || profile.label || profileId).slice(0, 80),
    endpoint,
    credential_ref: credentialRef,
    bridge_instance_id: instanceId,
    api_contract: String(profile.api_contract || "business-bridge-v2"),
    updated_at: profile.updated_at || new Date().toISOString()
  };
}

async function importSettingsBackup(backup) {
  const backupVersion = Number(backup?.backup_version || 0);
  if (!backup || backup.format !== "business-bridge-2-settings-backup" || ![1, 2, 3, 4, SETTINGS_BACKUP_VERSION].includes(backupVersion)) {
    throw new Error("Это не поддерживаемый backup Business Bridge 2.");
  }
  const incoming = backup.settings || {};
  if (backup.settings_sha256) {
    const actual = await sha256Hex(JSON.stringify(canonicalBackupValue(incoming)));
    if (actual !== String(backup.settings_sha256).toLowerCase()) throw new Error("Контрольная сумма backup не совпала.");
  }
  const incomingProfiles = incoming.profiles || {};
  const incomingCredentials = incoming.credentials || {};
  const validatedProfiles = {};
  for (const [id, raw] of Object.entries(incomingProfiles)) {
    const profile = validateImportedProfile({ ...raw, profile_id: raw.profile_id || id }, incomingCredentials);
    validatedProfiles[profile.profile_id] = profile;
  }
  const validatedDirectProfiles = {};
  for (const [id, raw] of Object.entries(incoming.direct_profiles || {})) {
    const profile = validateImportedDirectProfile(raw, id);
    validatedDirectProfiles[profile.profile_id] = profile;
  }
  const validatedAttachments = {};
  for (const [key, raw] of Object.entries(incoming.report_attachments || {})) {
    validatedAttachments[key] = validateAttachmentRecord(raw);
  }

  const validatedPrefixes = {};
  for (const [key, raw] of Object.entries(incoming.report_prefixes || {})) {
    const normalized = validateReportPrefixRecord(raw);
    if (normalized) validatedPrefixes[key] = normalized;
  }
  const importedCopyButtonProfiles = incoming.copy_button_profiles || incoming.copy_button_profile || null;

  const activeRuns = (await listRuns()).filter((run) => ![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status));
  await withStorageLock("settings_import", async () => {
    const current = await storageGet(exportedSettingsKeys());
    const profiles = { ...(current[KEYS.PROFILES] || {}) };
    const credentials = { ...(current[KEYS.CREDENTIALS] || {}) };
    const directProfiles = { ...(current[KEYS.DIRECT_PROFILES] || {}) };
    for (const profile of Object.values(validatedProfiles)) {
      const existing = profiles[profile.profile_id];
      if (existing && existing.bridge_instance_id !== profile.bridge_instance_id) {
        throw new Error(`Profile ID ${profile.profile_id} уже относится к другому Bridge instance.`);
      }
      profiles[profile.profile_id] = profile;
      credentials[profile.credential_ref] = String(incomingCredentials[profile.credential_ref]);
    }
    for (const profile of Object.values(validatedDirectProfiles)) {
      const existing = directProfiles[profile.profile_id];
      if (existing) {
        if (existing.server_instance_id !== profile.server_instance_id || existing.server_fingerprint !== profile.server_fingerprint || existing.device_id !== profile.device_id) {
          throw new Error(`Direct profile ID ${profile.profile_id} already refers to a different pinned identity.`);
        }
        directProfiles[profile.profile_id] = { ...profile, key_ref: existing.key_ref || null, connection_state: existing.key_ref ? (existing.connection_state || "DISCONNECTED") : "NEEDS_REPAIR", identity_warning: existing.key_ref ? (existing.identity_warning || null) : profile.identity_warning };
      } else {
        directProfiles[profile.profile_id] = profile;
      }
    }
    const validProfileIds = new Set(Object.keys(profiles));
    const importedBindings = Object.fromEntries(Object.entries(incoming.bindings || {}).filter(([, profileId]) => {
      const id = typeof profileId === "string" ? profileId : profileId?.profile_id;
      return validProfileIds.has(id);
    }).map(([key, profileId]) => [key, typeof profileId === "string" ? profileId : profileId.profile_id]));
    const importedPending = Object.fromEntries(Object.entries(incoming.pending_bindings || {}).filter(([, profileId]) => validProfileIds.has(profileId)));
    const defaultProfileId = validProfileIds.has(incoming.default_profile_id)
      ? incoming.default_profile_id
      : (current[KEYS.DEFAULT_PROFILE] || Object.keys(validatedProfiles)[0] || null);
    const mergedCopyButtonProfiles = mergeCopyButtonProfileCollectionsWithoutLoss(
      current[KEYS.COPY_BUTTON_PROFILES] || current[KEYS.COPY_BUTTON_PROFILE] || null,
      importedCopyButtonProfiles
    );
    await storageSet({
      [KEYS.PROFILES]: profiles,
      [KEYS.DIRECT_PROFILES]: directProfiles,
      [KEYS.CREDENTIALS]: credentials,
      [KEYS.DEFAULT_PROFILE]: defaultProfileId,
      [KEYS.BINDINGS]: { ...(current[KEYS.BINDINGS] || {}), ...importedBindings },
      [KEYS.PENDING_BINDINGS]: { ...(current[KEYS.PENDING_BINDINGS] || {}), ...importedPending },
      [KEYS.SEND_BUTTON_PROFILE]: incoming.send_button_profile || current[KEYS.SEND_BUTTON_PROFILE] || null,
      [KEYS.COPY_BUTTON_PROFILE]: legacyCompatibleCopyButtonProfile(mergedCopyButtonProfiles),
      [KEYS.COPY_BUTTON_PROFILES]: mergedCopyButtonProfiles,
      [KEYS.NEXT_ITERATION_CONFIGS]: { ...(current[KEYS.NEXT_ITERATION_CONFIGS] || {}), ...(incoming.next_iteration_configs || {}) },
      [KEYS.FOCUS_POLICIES]: { ...(current[KEYS.FOCUS_POLICIES] || {}), ...(incoming.focus_policies || {}) },
      [KEYS.RESOURCE_POLICIES]: { ...(current[KEYS.RESOURCE_POLICIES] || {}), ...(incoming.resource_policies || {}) },
      [KEYS.REPORT_ATTACHMENTS]: { ...(current[KEYS.REPORT_ATTACHMENTS] || {}), ...validatedAttachments },
      [KEYS.REPORT_PREFIXES]: { ...(current[KEYS.REPORT_PREFIXES] || {}), ...validatedPrefixes },
      [KEYS.MANUAL_MODES]: { ...(current[KEYS.MANUAL_MODES] || {}), ...(incoming.manual_modes || {}) },
      [KEYS.SETTINGS_SCHEMA]: SETTINGS_SCHEMA_VERSION
    });
  });
  await diagnostic("SETTINGS_IMPORTED", { imported_profiles: Object.keys(validatedProfiles).length, imported_direct_profiles: Object.keys(validatedDirectProfiles).length, preserved_active_runs: activeRuns.length });
  return { imported_profiles: Object.keys(validatedProfiles).length, imported_direct_profiles: Object.keys(validatedDirectProfiles).length, preserved_active_runs: activeRuns.length };
}
