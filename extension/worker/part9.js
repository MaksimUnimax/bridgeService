async function resolveNextIterationExecutor(run) {
  const settings = await getConversationSettings({ origin: run.origin, conversation_id: run.conversation_id }, run.tab_id);
  const requested = String(settings.next.executor_id || run.executor_id || "");
  if (!requested) throw new Error("CLI следующей итерации не выбрана.");
  let selected = requested;
  let failoverFrom = null;
  if (settings.next.wait_for_selected_executor === false) {
    try {
      const catalog = await getExecutors(run.profile_snapshot.profile_id);
      const configured = (catalog.executors || []).filter((item) => item.enabled !== false && item.configured !== false);
      const requestedEntry = configured.find((item) => item.executor_id === requested);
      if (!requestedEntry || requestedEntry.health !== "available") {
        const fallback = configured.find((item) => item.health === "available");
        if (fallback) {
          selected = fallback.executor_id;
          if (selected !== requested) failoverFrom = requested;
        }
      }
    } catch (error) {
      await diagnostic("EXECUTOR_FAILOVER_CATALOG_UNAVAILABLE", { run_id: run.run_id, error: error.message });
    }
  }
  return {
    executor_id: selected,
    requested_executor_id: requested,
    failover_from: failoverFrom,
    focus_policy: settings.next.focus_policy || "report_only",
    wait_for_selected_executor: settings.next.wait_for_selected_executor !== false
  };
}

async function ensureRunExecutorChain(run, selection) {
  const desired = selection.executor_id;
  let updated = BB2Model.evolveRun(run, {
    focus_policy: selection.focus_policy,
    wait_for_selected_executor: selection.wait_for_selected_executor,
    next_iteration_executor_id: selection.requested_executor_id,
    failover_from_executor_id: selection.failover_from || null
  });
  if (desired === run.executor_id) {
    await saveRun(updated);
    return updated;
  }

  const token = await tokenForSnapshot(run.profile_snapshot);
  const oldChainId = run.chain_id;
  const chainKey = `${run.run_id}:segment:${run.sequence}:${desired}`;
  const chain = await bridgeFetch(run.profile_snapshot, token, "/v2/chains", {
    method: "POST",
    body: {
      idempotency_key: chainKey,
      client_id: run.client_installation_id,
      local_run_id: run.run_id,
      conversation_ref: run.conversation_id || run.conversation_ref,
      executor_id: desired
    }
  });
  updated = BB2Model.evolveRun(updated, {
    chain_id: chain.chain_id,
    chain_sequence: 0,
    executor_id: desired,
    previous_chain_ids: [...new Set([...(run.previous_chain_ids || []), oldChainId])]
  });
  await saveRun(updated);
  await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(oldChainId)}/terminate`, {
    method: "POST",
    body: { client_id: run.client_installation_id, reason: "executor_changed_for_next_iteration" }
  }).catch(() => null);
  await diagnostic("ITERATION_EXECUTOR_CHANGED", {
    run_id: run.run_id,
    old_chain_id: oldChainId,
    new_chain_id: chain.chain_id,
    old_executor_id: run.executor_id,
    new_executor_id: desired,
    requested_executor_id: selection.requested_executor_id,
    failover_from_executor_id: selection.failover_from || null
  });
  return updated;
}

async function createManualOneShotRun({ message, tab, identity, bound, executorId }) {
  const verified = await validateProfile(bound.profile, bound.credential);
  if (verified.instance_id !== bound.profile.bridge_instance_id) throw new Error("Bridge instance identity changed.");
  const client = await clientId();
  const runId = uuid("run");
  const profileSnap = BB2Protocol.profileSnapshot(bound.profile);
  const settings = await getConversationSettings(identity, tab.id);
  const chain = await bridgeFetch(profileSnap, bound.credential, "/v2/chains", {
    method: "POST",
    body: {
      idempotency_key: `manual:${message.manual_request_id}`,
      client_id: client,
      local_run_id: runId,
      conversation_ref: identity.conversation_id,
      executor_id: executorId
    }
  });
  let run = BB2Model.createRun({
    runId,
    clientId: client,
    tabId: tab.id,
    windowId: tab.windowId,
    identity,
    profileSnapshot: profileSnap,
    executorId,
    chainId: chain.chain_id,
    conversationRef: identity.conversation_id
  });
  run = BB2Model.evolveRun(run, {
    status: BB2Model.RUN_STATUSES.SUBMITTING_JOB,
    chain_sequence: 0,
    focus_policy: settings.next.focus_policy || "report_only",
    wait_for_selected_executor: settings.next.wait_for_selected_executor !== false,
    next_iteration_executor_id: executorId,
    context_settings_key: settings.key,
    manual_one_shot: true,
    manual_request_id: message.manual_request_id,
    submission_origin: "manual",
    pending_submission: {
      idempotency_key: BB2ManualControls.manualRequestIdempotencyKey(runId, message.manual_request_id),
      assistant_turn_id: message.assistant_turn_id,
      prompt_text: message.prompt_text,
      prompt_fingerprint: message.prompt_fingerprint || BB2Protocol.fnv1a32(message.prompt_text)
    },
    error: null
  });
  await saveRun(run);
  await diagnostic("MANUAL_ONE_SHOT_CREATED", {
    run_id: run.run_id,
    chain_id: run.chain_id,
    executor_id: run.executor_id,
    assistant_turn_id: message.assistant_turn_id
  });
  schedulePoll(run.run_id, 0);
  return run;
}

async function submitManualWritingBlock(message, sender) {
  const tab = sender?.tab;
  if (!tab?.id) throw new Error("Manual submission must come from a ChatGPT tab.");
  const identity = message.identity || await tabIdentity(tab.id);
  if (!identity?.conversation_id) throw new Error("Manual submission requires an existing ChatGPT conversation.");
  const liveIdentity = await tabIdentity(tab.id);
  if (BB2Protocol.conversationKey(liveIdentity) !== BB2Protocol.conversationKey(identity)) {
    throw new Error("Conversation mismatch.");
  }
  const length = BB2Protocol.codePointLength(message.prompt_text);
  if (!message.prompt_text || length > BB2Protocol.MAX_PROMPT_CODE_POINTS) {
    throw new Error(`Prompt length ${length}; max ${BB2Protocol.MAX_PROMPT_CODE_POINTS}.`);
  }
  if (!message.manual_request_id) throw new Error("Manual request ID is missing.");

  return withStorageLock(`manual:${BB2Protocol.conversationKey(identity)}`, async () => {
    const duplicate = (await listRuns()).find((item) => item.manual_request_id === message.manual_request_id);
    if (duplicate) return { accepted: true, duplicate: true, run_id: duplicate.run_id, status: duplicate.status };

    const bound = await strictBoundProfileForContext(identity, tab.id);
    if (!bound.binding_exists) throw new Error("Диалог не привязан к Bridge-профилю.");
    if (!bound.profile) throw new Error("Привязанный Bridge-профиль недоступен.");
    if (!bound.credential) throw new Error("Token привязанного Bridge-профиля отсутствует.");
    const settings = await getConversationSettings(identity, tab.id);
    const active = await activeRunForContext(identity, tab.id);
    const executorId = String(settings.next.executor_id || active?.executor_id || "");
    if (!executorId) throw new Error("CLI для следующей итерации не выбрана.");

    if (!active) {
      const run = await createManualOneShotRun({ message, tab, identity, bound, executorId });
      return { accepted: true, run_id: run.run_id, status: run.status, manual_one_shot: true };
    }

    return withRunLock(active.run_id, async () => {
      let run = await getRun(active.run_id);
      if (!BB2ManualControls.isOperatorPausedIdle(run)) {
        if (BB2ManualControls.isBusyRun(run) || run?.pause_requested === true) {
          await diagnostic("MANUAL_SUBMISSION_BLOCKED_RUN_BUSY", { run_id: run?.run_id || active.run_id, status: run?.status || null });
          return { accepted: false, code: "RUN_BUSY", title: "Bridge уже выполняет или доставляет задачу.", run_id: run?.run_id || active.run_id, status: run?.status || null };
        }
        return { accepted: false, code: "MANUAL_UNAVAILABLE", title: "Ручная отправка сейчас недоступна.", run_id: run?.run_id || active.run_id, status: run?.status || null };
      }
      const selection = await resolveNextIterationExecutor(run);
      const previousChainId = run.chain_id;
      run = await ensureRunExecutorChain(run, selection);
      const token = await tokenForSnapshot(run.profile_snapshot);
      if (run.chain_id === previousChainId) {
        await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/resume`, {
          method: "POST",
          run_id: run.run_id,
          body: { client_id: run.client_installation_id }
        });
      }
      run = BB2Model.evolveRun(run, {
        status: BB2Model.RUN_STATUSES.SUBMITTING_JOB,
        resume_status: BB2Model.RUN_STATUSES.WAITING_PROMPT,
        pause_reason: "operator",
        pause_after_delivery: true,
        manual_request_id: message.manual_request_id,
        submission_origin: "manual",
        pending_submission: {
          idempotency_key: BB2ManualControls.manualRequestIdempotencyKey(run.run_id, message.manual_request_id),
          assistant_turn_id: message.assistant_turn_id,
          prompt_text: message.prompt_text,
          prompt_fingerprint: message.prompt_fingerprint || BB2Protocol.fnv1a32(message.prompt_text)
        },
        error: null
      });
      await saveRun(run);
      await diagnostic("MANUAL_PROMPT_ACCEPTED_IN_PAUSE", {
        run_id: run.run_id,
        assistant_turn_id: message.assistant_turn_id,
        executor_id: run.executor_id
      });
      schedulePoll(run.run_id, 0);
      return { accepted: true, run_id: run.run_id, status: run.status, manual_one_shot: false };
    });
  });
}
