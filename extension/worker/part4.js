async function tokenForSnapshot(snapshot) {
  const data = await storageGet(KEYS.CREDENTIALS);
  const token = (data[KEYS.CREDENTIALS] || {})[snapshot.credential_ref];
  if (!token) throw new Error("Credential for immutable run profile snapshot is unavailable.");
  return token;
}

async function validateProfile(profile, token) {
  const identity = await bridgeFetch(profile, token, "/v2/identity", { timeout_ms: 8000 });
  if (identity.api_contract !== BB2Protocol.API_CONTRACT) {
    throw new Error(`Unsupported API contract: ${identity.api_contract || "unknown"}.`);
  }
  if (!identity.instance_id) throw new Error("Bridge identity does not contain instance_id.");
  return identity;
}

async function activeChatTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || "")) {
    throw new Error("Открой нужный диалог ChatGPT в активной вкладке.");
  }
  return tab;
}

function tabMessage(tabId, message, timeoutMs = 35000) {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "Content adapter response timed out." });
    }, timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const error = chrome.runtime.lastError;
      if (error) resolve({ ok: false, error: error.message || "Content adapter unavailable." });
      else resolve(response || { ok: false, error: "Empty content adapter response." });
    });
  });
}

async function tabIdentity(tabId) {
  const response = await tabMessage(tabId, { type: "BB2_GET_IDENTITY" }, 5000);
  if (!response.ok) throw new Error(response.error || "Cannot read ChatGPT identity.");
  return response.identity;
}

async function resolvePopupContext(context) {
  if (!context || !Number.isInteger(context.tab_id)) throw new Error("Popup context is missing or stale.");
  const tab = await chrome.tabs.get(context.tab_id).catch(() => null);
  if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || "")) {
    throw new Error("Привязанная вкладка ChatGPT закрыта или больше не является ChatGPT.");
  }
  const here = await tabIdentity(tab.id);
  const expectedOrigin = String(context.origin || "").toLowerCase();
  const actualOrigin = String(here?.origin || "").toLowerCase();
  const expectedConversation = context.conversation_id || null;
  const actualConversation = here?.conversation_id || null;
  if (expectedOrigin !== actualOrigin || expectedConversation !== actualConversation) {
    throw new Error("Контекст popup изменился. Открой popup заново в нужном диалоге.");
  }
  return { tab, identity: here };
}

async function activateRunTab(run, reason = "report") {
  const tab = await chrome.tabs.get(run.tab_id).catch(() => null);
  if (!tab) throw new Error("Привязанная вкладка ChatGPT закрыта.");
  const policy = run.focus_policy || "report_only";
  const shouldFocus = policy === "always" || (policy === "report_only" && reason === "report");
  if (!shouldFocus) return tab;
  if (run.window_id !== undefined && run.window_id !== null) {
    await chrome.windows.update(run.window_id, { focused: true }).catch(() => null);
  }
  await chrome.tabs.update(run.tab_id, { active: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await diagnostic("RUN_TAB_ACTIVATED", { run_id: run.run_id, reason, focus_policy: policy });
  return tab;
}

async function bindProfileToIdentity(profileId, identity, tabId) {
  return withStorageLock("bindings", async () => {
    const { bindings, pending } = await getBindings();
    const key = BB2Protocol.conversationKey(identity);
    if (key) {
      bindings[key] = profileId;
      delete pending[String(tabId)];
    } else {
      pending[String(tabId)] = profileId;
    }
    await storageSet({ [KEYS.BINDINGS]: bindings, [KEYS.PENDING_BINDINGS]: pending });
  });
}

async function selectedProfileForContext(identity, tabId, explicitProfileId = null) {
  const { profiles, defaultProfileId } = await getProfilesAndCredentials();
  if (explicitProfileId) {
    if (!profiles[explicitProfileId]) throw new Error("Выбранный Bridge-профиль отсутствует.");
    return profiles[explicitProfileId];
  }
  const { bindings, pending } = await getBindings();
  const key = BB2Protocol.conversationKey(identity);
  if (key && Object.prototype.hasOwnProperty.call(bindings, key)) {
    const resolved = BB2Model.resolveProfileForConversation({
      bindingProfileId: bindings[key], defaultProfileId, profiles, bindingExists: true
    });
    if (!resolved.ok) throw new Error("Диалог привязан к отсутствующему Bridge-профилю. Автоматический fallback запрещён.");
    return resolved.profile;
  }
  const pendingProfileId = pending[String(tabId)];
  if (pendingProfileId) {
    if (!profiles[pendingProfileId]) throw new Error("Временная привязка вкладки указывает на отсутствующий профиль.");
    return profiles[pendingProfileId];
  }
  const resolved = BB2Model.resolveProfileForConversation({
    bindingProfileId: null, defaultProfileId, profiles, bindingExists: false
  });
  if (!resolved.ok) throw new Error("Bridge-профиль не выбран.");
  return resolved.profile;
}

async function strictBoundProfileForContext(identity, tabId) {
  const { profiles, credentials } = await getProfilesAndCredentials();
  const { bindings, pending } = await getBindings();
  const key = BB2Protocol.conversationKey(identity);
  const binding = BB2ManualControls.strictBindingRecord({
    conversationKey: key,
    bindings,
    pending,
    tabId
  });
  const profileId = binding.profileId;
  if (!binding.exists) return { binding_exists: false, profile: null, credential: null };
  const profile = profiles[profileId] || null;
  return {
    binding_exists: true,
    profile_id: profileId || null,
    profile,
    credential: profile ? (credentials[profile.credential_ref] || null) : null
  };
}

async function manualButtonStateForContext(identity, tabId) {
  const bound = await strictBoundProfileForContext(identity, tabId);
  if (!bound.binding_exists) {
    return BB2ManualControls.manualButtonDecision({ bindingExists: false });
  }
  const run = await activeRunForContext(identity, tabId);
  const settings = await getConversationSettings(identity, tabId);
  const executorId = String(settings.next.executor_id || run?.executor_id || "");
  const profileForState = run?.profile_snapshot || bound.profile;
  const credentialForState = run
    ? (await tokenForSnapshot(run.profile_snapshot).catch(() => null))
    : bound.credential;
  const transport = profileForState?.profile_id
    ? BB2Transport.publicState(await transportStateForProfile(profileForState.profile_id))
    : BB2Transport.publicState(BB2Transport.initial());
  return {
    ...BB2ManualControls.manualButtonDecision({
      bindingExists: true,
      profileExists: Boolean(profileForState),
      credentialExists: Boolean(credentialForState),
      transportState: transport.state,
      executorId,
      run
    }),
    executor_id: executorId || null,
    profile_id: profileForState?.profile_id || bound.profile_id || null,
    profile_name: profileForState?.name || bound.profile?.name || null,
    run_id: run?.run_id || null,
    run_status: run?.status || null
  };
}

async function activeRunForContext(identity, tabId) {
  const key = BB2Protocol.conversationKey(identity);
  const runs = await listRuns();
  return runs.find((run) => ![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status) && (
    (key && run.conversation_key === key) || (!key && run.tab_id === tabId && !run.conversation_id)
  )) || null;
}

function schedulePoll(runId, delay = BB2Protocol.JOB_POLL_MS) {
  if (pollTimers.has(runId)) clearTimeout(pollTimers.get(runId));
  const timer = setTimeout(() => {
    pollTimers.delete(runId);
    pollRun(runId).catch((error) => diagnostic("POLL_RUN_ERROR", { run_id: runId, error: error.message }));
  }, delay);
  pollTimers.set(runId, timer);
}

async function showRunStatus(run, text, tone = "operator_work") {
  await tabMessage(run.tab_id, { type: "BB2_SHOW_STATUS", text, tone }, 5000).catch(() => null);
}

async function beginPromptWatch(run) {
  if (!run.conversation_id || !run.prompt_watch_id) return false;
  await activateRunTab(run, "prompt").catch(() => null);
  const response = await tabMessage(run.tab_id, {
    type: "BB2_BEGIN_PROMPT_WATCH",
    run_id: run.run_id,
    conversation_id: run.conversation_id,
    watch_id: run.prompt_watch_id,
    assistant_baseline_ids: Array.isArray(run.assistant_baseline_ids) ? run.assistant_baseline_ids : []
  }, 5000);
  if (!response.ok) {
    await diagnostic("PROMPT_WATCH_START_FAILED", { run_id: run.run_id, error: response.error });
    return false;
  }
  return true;
}

async function submitPendingJob(runId) {
  return withRunLock(runId, async () => {
    let run = await getRun(runId);
    if (!run || run.status !== BB2Model.RUN_STATUSES.SUBMITTING_JOB || !run.pending_submission) return;
    const token = await tokenForSnapshot(run.profile_snapshot);
    try {
      const payload = await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/jobs`, {
        method: "POST",
        run_id: run.run_id,
        body: {
          idempotency_key: run.pending_submission.idempotency_key,
          sequence: Number(run.chain_sequence ?? run.sequence ?? 0),
          executor_id: run.executor_id,
          assistant_turn_id: run.pending_submission.assistant_turn_id,
          prompt_text: run.pending_submission.prompt_text,
          prompt_fingerprint: run.pending_submission.prompt_fingerprint
        },
        timeout_ms: 12000
      });
      run = BB2Model.evolveRun(run, {
        status: BB2Model.RUN_STATUSES.WAITING_JOB,
        current_job_id: payload.job_id,
        current_job_revision: Number(payload.revision || 0),
        consumed_assistant_turn_id: run.pending_submission.assistant_turn_id,
        pending_submission: null,
        retry_state: { ...(run.retry_state || {}), submit: 0, poll: 0 },
        error: null
      });
      await saveRun(run);
      await diagnostic("JOB_ACCEPTED", { run_id: run.run_id, job_id: run.current_job_id, sequence: run.sequence, chain_sequence: Number(run.chain_sequence ?? run.sequence ?? 0), executor_id: run.executor_id });
      if (run.submission_origin === "manual" && run.pause_after_delivery === true) {
        await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/pause`, {
          method: "POST",
          run_id: run.run_id,
          body: { client_id: run.client_installation_id, reason: "manual_job_accepted_while_operator_paused" }
        }).catch(() => null);
      }
      await showRunStatus(run, `Business Bridge 2: CLI «${run.executor_id || "неизвестная"}» выполняет задачу.`, "cli_work");
      schedulePoll(run.run_id, 500);
    } catch (error) {
      const disposition = BB2Protocol.bridgeErrorDisposition(error.status, error.code, "job_submit");
      if (disposition === "retry") {
        await scheduleTransientRetry(run, "submit", error, "JOB_SUBMIT_RETRY_SCHEDULED", { baseMs: 2000, maxMs: 60000 });
      } else {
        await failRun(run, "submit", error, "JOB_SUBMIT_PERMANENT_FAILURE");
      }
    }
  });
}
