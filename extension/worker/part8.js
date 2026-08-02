async function migrateLegacySettingsIfPresent() {
  return withStorageLock("legacy_migration", async () => {
    const current = await getProfilesAndCredentials();
    if (Object.keys(current.profiles).length) return { migrated: false, reason: "bb2_profiles_exist" };
    const legacy = await storageGet([
      "bridge_profiles",
      "bridge_profile_credentials",
      "active_bridge_profile_id",
      "conversation_bridge_profile_bindings",
      "send_button_profile",
      "conversation_focus_policies",
      "conversation_resource_recovery_policies",
      "conversation_next_iteration_configs",
      "conversation_report_attachment_configs"
    ]);
    const oldProfiles = legacy.bridge_profiles || {};
    const oldCredentials = legacy.bridge_profile_credentials || {};
    if (!Object.keys(oldProfiles).length) return { migrated: false, reason: "legacy_absent" };
    const profiles = {};
    const credentials = {};
    const profileIdMap = {};
    for (const [oldId, old] of Object.entries(oldProfiles)) {
      if (!old || typeof old !== "object") continue;
      const oldRef = String(old.credential_ref || "");
      const token = String(oldCredentials[oldRef] || "").trim();
      const instanceId = String(old.expected_bridge_instance_id || old.bridge_instance_id || "").toLowerCase();
      if (!token || !instanceId) continue;
      let profileId = String(old.profile_id || oldId);
      if (!/^profile-[0-9a-f-]{20,}$/i.test(profileId)) profileId = uuid("profile");
      const credentialRef = uuid("credential");
      profiles[profileId] = {
        profile_id: profileId,
        profile_revision: Math.max(1, Number(old.profile_revision || 1)),
        name: String(old.label || old.bridge_profile_label || `Bridge ${instanceId.slice(0, 8)}`).slice(0, 80),
        endpoint: BB2Protocol.normalizedEndpoint(old.local_api_url || old.bridge_local_api_url),
        credential_ref: credentialRef,
        bridge_instance_id: instanceId,
        api_contract: "business-bridge-v2",
        deployment_revision: "",
        created_at: old.verified_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      credentials[credentialRef] = token;
      profileIdMap[oldId] = profileId;
    }
    if (!Object.keys(profiles).length) return { migrated: false, reason: "legacy_invalid" };
    const bindings = {};
    for (const [key, value] of Object.entries(legacy.conversation_bridge_profile_bindings || {})) {
      const oldId = typeof value === "string" ? value : value?.profile_id;
      if (!profileIdMap[oldId]) continue;
      const match = key.match(/^conversation:v1:(https?:\/\/[^:]+(?::\d+)?):([0-9a-f-]{36})$/i);
      const newKey = match ? `${match[1].toLowerCase()}|${match[2].toLowerCase()}` : key;
      bindings[newKey] = profileIdMap[oldId];
    }
    const activeOld = legacy.active_bridge_profile_id;
    await storageSet({
      [KEYS.PROFILES]: profiles,
      [KEYS.CREDENTIALS]: credentials,
      [KEYS.DEFAULT_PROFILE]: profileIdMap[activeOld] || Object.keys(profiles)[0],
      [KEYS.BINDINGS]: bindings,
      [KEYS.SEND_BUTTON_PROFILE]: legacy.send_button_profile || null,
      [KEYS.FOCUS_POLICIES]: legacy.conversation_focus_policies || {},
      [KEYS.RESOURCE_POLICIES]: legacy.conversation_resource_recovery_policies || {},
      [KEYS.NEXT_ITERATION_CONFIGS]: legacy.conversation_next_iteration_configs || {},
      [KEYS.REPORT_ATTACHMENTS]: legacy.conversation_report_attachment_configs || {},
      [KEYS.SETTINGS_SCHEMA]: SETTINGS_SCHEMA_VERSION
    });
    await diagnostic("LEGACY_SETTINGS_MIGRATED", { profiles: Object.keys(profiles).length, bindings: Object.keys(bindings).length });
    return { migrated: true, profiles: Object.keys(profiles).length };
  });
}

async function getExecutors(profileId) {
  if (executorCatalogRequests.has(profileId)) return executorCatalogRequests.get(profileId);
  const request = loadExecutors(profileId).finally(() => {
    if (executorCatalogRequests.get(profileId) === request) executorCatalogRequests.delete(profileId);
  });
  executorCatalogRequests.set(profileId, request);
  return request;
}

async function loadExecutors(profileId) {
  const { profiles, credentials } = await getProfilesAndCredentials();
  const profile = profiles[profileId];
  if (!profile) throw new Error("Bridge-профиль отсутствует.");
  const token = credentials[profile.credential_ref];
  if (!token) throw new Error("Token профиля отсутствует.");
  const cachedData = await storageGet(KEYS.EXECUTOR_CATALOGS);
  const catalogs = cachedData[KEYS.EXECUTOR_CATALOGS] || {};
  const cached = catalogs[profileId];
  const validCached = cached &&
    cached.profile_revision === profile.profile_revision &&
    cached.bridge_instance_id === profile.bridge_instance_id &&
    Array.isArray(cached.executors) && cached.executors.length > 0;
  try {
    const identity = await validateProfile(profile, token);
    if (identity.instance_id !== profile.bridge_instance_id) throw new Error("Bridge identity mismatch.");
    const payload = await bridgeFetch(profile, token, "/v2/executors", { timeout_ms: 8000 });
    const catalog = {
      profile_revision: profile.profile_revision,
      bridge_instance_id: profile.bridge_instance_id,
      executors: payload.executors || [],
      server_freshness: payload.freshness || "unknown",
      server_checked_at: payload.checked_at || null,
      fetched_at: new Date().toISOString()
    };
    await withStorageLock("executor_catalogs", async () => {
      const latestProfiles = await getProfilesAndCredentials();
      const latestProfile = latestProfiles.profiles[profileId];
      if (!latestProfile || latestProfile.profile_revision !== profile.profile_revision || latestProfile.bridge_instance_id !== profile.bridge_instance_id) {
        throw new Error("Bridge profile changed while the executor catalog was loading.");
      }
      const latestData = await storageGet(KEYS.EXECUTOR_CATALOGS);
      const latestCatalogs = latestData[KEYS.EXECUTOR_CATALOGS] || {};
      latestCatalogs[profileId] = catalog;
      await storageSet({ [KEYS.EXECUTOR_CATALOGS]: latestCatalogs });
    });
    return {
      executors: catalog.executors,
      freshness: catalog.server_freshness,
      checked_at: catalog.server_checked_at,
      fetched_at: catalog.fetched_at,
      warning: null,
      transport: BB2Transport.publicState(await transportStateForProfile(profileId))
    };
  } catch (error) {
    const transport = BB2Transport.publicState(await transportStateForProfile(profileId));
    if (!validCached) {
      await diagnostic("EXECUTOR_CATALOG_UNAVAILABLE", { profile_id: profileId, code: error.code, error: error.message }, { level: "error" });
      return {
        executors: [],
        freshness: "unavailable",
        checked_at: null,
        fetched_at: null,
        warning: error.message,
        error_code: error.code || "EXECUTOR_CATALOG_UNAVAILABLE",
        transport
      };
    }
    await diagnostic("EXECUTOR_CATALOG_STALE_FALLBACK", { profile_id: profileId, code: error.code, error: error.message, fetched_at: cached.fetched_at });
    return {
      executors: cached.executors,
      freshness: "client_stale",
      checked_at: cached.server_checked_at || null,
      fetched_at: cached.fetched_at || null,
      warning: error.message,
      error_code: error.code || null,
      transport
    };
  }
}


async function refreshExecutorsNow(profileId) {
  if (executorRefreshRequests.has(profileId)) return executorRefreshRequests.get(profileId);
  const operation = (async () => {
    const { profiles, credentials } = await getProfilesAndCredentials();
    const profile = profiles[profileId];
    if (!profile) throw new Error("Bridge-профиль отсутствует.");
    const token = credentials[profile.credential_ref];
    if (!token) throw new Error("Token профиля отсутствует.");
    const beforeData = await storageGet(KEYS.EXECUTOR_CATALOGS);
    const beforeCheckedAt = (beforeData[KEYS.EXECUTOR_CATALOGS] || {})[profileId]?.server_checked_at || null;
    await diagnostic("EXECUTOR_REFRESH_REQUESTED", { profile_id: profileId, before_checked_at: beforeCheckedAt });
    const refresh = await bridgeFetch(profile, token, "/v2/executors/refresh", {
      method: "POST",
      body: {},
      timeout_ms: 8000
    });
    const deadline = Date.now() + 10000;
    let latest = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      latest = await loadExecutors(profileId);
      if (latest.checked_at && latest.checked_at !== beforeCheckedAt) {
        await diagnostic("EXECUTOR_REFRESH_COMPLETED", {
          profile_id: profileId,
          refresh_id: refresh.refresh_id || null,
          checked_at: latest.checked_at,
          freshness: latest.freshness
        });
        return { ...latest, refresh_id: refresh.refresh_id || null, refresh_state: "completed" };
      }
      if (refresh.state === "completed" && latest.freshness === "fresh") {
        await diagnostic("EXECUTOR_REFRESH_COMPLETED", {
          profile_id: profileId,
          refresh_id: refresh.refresh_id || null,
          checked_at: latest.checked_at,
          freshness: latest.freshness
        });
        return { ...latest, refresh_id: refresh.refresh_id || null, refresh_state: "completed" };
      }
    }
    latest = latest || await loadExecutors(profileId);
    await diagnostic("EXECUTOR_REFRESH_PENDING", {
      profile_id: profileId,
      refresh_id: refresh.refresh_id || null,
      checked_at: latest.checked_at,
      freshness: latest.freshness
    }, { level: "warning" });
    return { ...latest, refresh_id: refresh.refresh_id || null, refresh_state: "pending", warning: latest.warning || "Сервер принял refresh, но новый snapshot ещё не появился." };
  })().finally(() => {
    if (executorRefreshRequests.get(profileId) === operation) executorRefreshRequests.delete(profileId);
  });
  executorRefreshRequests.set(profileId, operation);
  return operation;
}

async function finalizeStartConfirmation(run, identity, assistantBaselineIds) {
  if (!identity?.conversation_id) throw new Error("Start confirmation is incomplete.");
  const token = await tokenForSnapshot(run.profile_snapshot);
  if (run.conversation_ref !== identity.conversation_id) {
    await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/bind-conversation`, {
      method: "POST",
      body: { client_id: run.client_installation_id, conversation_ref: identity.conversation_id }
    });
  }
  await bindProfileToIdentity(run.profile_snapshot.profile_id, identity, run.tab_id);
  await promotePendingConversationSettings(run.tab_id, identity);
  const nextWatchId = promptWatchId(run, "start");
  run = BB2Model.confirmStart(run, {
    origin: identity.origin,
    conversationId: identity.conversation_id,
    conversationRef: identity.conversation_id,
    conversationKey: BB2Protocol.conversationKey(identity),
    promptWatchId: nextWatchId,
    assistantBaselineIds
  });
  run.retry_state = { ...(run.retry_state || {}), start: 0 };
  await saveRun(run);
  await diagnostic("START_COMPOSER_EMPTIED", {
    run_id: run.run_id,
    chain_id: run.chain_id,
    watch_id: nextWatchId,
    assistant_baseline_count: Array.isArray(assistantBaselineIds) ? assistantBaselineIds.length : 0
  });
  await beginPromptWatch(run);
  return run;
}

function startRunLockKey(message) {
  const context = message?.context || {};
  const origin = String(context.origin || "").toLowerCase();
  const conversation = context.conversation_id ? String(context.conversation_id).toLowerCase() : `tab:${context.tab_id}`;
  return `start:${origin}|${conversation}`;
}

async function startRun(message) {
  return withStorageLock(startRunLockKey(message), () => startRunUnlocked(message));
}

async function startRunUnlocked(message) {
  const context = await resolvePopupContext(message.context);
  const tab = context.tab;
  const beforeIdentity = context.identity;
  const manualModeActive = await getManualModeForContext(beforeIdentity, tab.id);
  if (manualModeActive) {
    await diagnostic("AUTO_MODE_START_BLOCKED_BY_MANUAL_MODE", {
      conversation_id: beforeIdentity.conversation_id || null,
      tab_id: tab.id
    }, { level: "warning" });
    throw Object.assign(
      new Error("Сначала отключите ручной режим writing blocks."),
      { code: "MANUAL_MODE_ACTIVE" }
    );
  }
  const existingRun = await activeRunForContext(beforeIdentity, tab.id);
  if (existingRun) throw new Error(`В этом диалоге уже есть активный run: ${existingRun.run_id}.`);
  const profile = await selectedProfileForContext(beforeIdentity, tab.id, message.profile_id || null);
  const { credentials } = await getProfilesAndCredentials();
  const token = credentials[profile.credential_ref];
  if (!token) throw new Error("Token выбранного профиля отсутствует.");
  const verified = await validateProfile(profile, token);
  if (verified.instance_id !== profile.bridge_instance_id) throw new Error("Bridge instance identity changed.");

  const client = await clientId();
  const runId = uuid("run");
  const pendingRef = beforeIdentity.conversation_id
    ? beforeIdentity.conversation_id
    : BB2Protocol.temporaryConversationRef(client, tab.id, crypto.randomUUID());
  const profileSnap = BB2Protocol.profileSnapshot(profile);
  const conversationSettings = await getConversationSettings(beforeIdentity, tab.id);
  const selectedExecutorId = String(message.executor_id || conversationSettings.next.executor_id || "");
  if (!selectedExecutorId) throw new Error("CLI для следующей итерации не выбрана.");
  const chain = await bridgeFetch(profileSnap, token, "/v2/chains", {
    method: "POST",
    body: {
      idempotency_key: runId,
      client_id: client,
      local_run_id: runId,
      conversation_ref: pendingRef,
      executor_id: selectedExecutorId
    }
  });
  let run = BB2Model.createRun({
    runId,
    clientId: client,
    tabId: tab.id,
    windowId: tab.windowId,
    identity: beforeIdentity,
    profileSnapshot: profileSnap,
    executorId: selectedExecutorId,
    chainId: chain.chain_id,
    conversationRef: pendingRef
  });
  run = BB2Model.evolveRun(run, {
    chain_sequence: 0,
    focus_policy: conversationSettings.next.focus_policy || "report_only",
    wait_for_selected_executor: conversationSettings.next.wait_for_selected_executor !== false,
    next_iteration_executor_id: selectedExecutorId,
    context_settings_key: conversationSettings.key
  });
  await saveRun(run);
  await diagnostic("RUN_CREATED", {
    run_id: runId,
    chain_id: chain.chain_id,
    profile_id: profile.profile_id,
    executor_id: selectedExecutorId,
    focus_policy: run.focus_policy,
    wait_for_selected_executor: run.wait_for_selected_executor
  });

  await diagnostic("START_DISPATCH_REQUESTED", { run_id: run.run_id, tab_id: tab.id, chain_id: run.chain_id });
  const sent = await tabMessage(tab.id, { type: "BB2_SEND_START", run_id: run.run_id, message_text: BB2Protocol.START_MESSAGE }, 600000);
  await diagnostic("START_DISPATCH_RESPONSE", {
    run_id: run.run_id,
    tab_id: tab.id,
    ok: sent.ok === true,
    committed: sent.committed === true,
    click_dispatched: sent.click_dispatched === true,
    click_method_called: sent.click_method_called === true,
    click_event_observed: sent.click_event_observed === true,
    code: sent.code || null,
    error: sent.error || null
  }, { level: sent.ok ? "info" : "error" });
  run = await getRun(run.run_id) || run;
  if (sent.ok && sent.composer_empty === true) {
    const afterIdentity = sent.identity || await tabIdentity(tab.id);
    const assistantBaselineIds = Array.isArray(sent.assistant_baseline_ids)
      ? sent.assistant_baseline_ids
      : await currentPromptBaseline(run);
    run = await finalizeStartConfirmation(run, afterIdentity, assistantBaselineIds);
    await diagnostic("START_SEND_COMPLETED", {
      run_id: run.run_id,
      click_attempts: Number(sent.click_attempts || 0)
    });
    return { run_id: run.run_id, status: run.status };
  }
  await bridgeFetch(profileSnap, token, `/v2/chains/${encodeURIComponent(chain.chain_id)}/terminate`, { method: "POST", body: { client_id: run.client_installation_id, reason: "start_composer_send_failed" } }).catch(() => null);
  run = BB2Model.evolveRun(run, { status: BB2Model.RUN_STATUSES.ERROR, error: { code: sent.code || "START_FAILED", message: sent.error || "Start composer did not become empty." } });
  await saveRun(run);
  await showRunStatus(run, `Business Bridge 2: ошибка запуска — ${run.error.message}`, "error");
  throw Object.assign(new Error(run.error.message), { code: run.error.code });
}
