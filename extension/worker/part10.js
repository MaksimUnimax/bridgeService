async function handlePromptReady(message) {
  return withRunLock(message.run_id, async () => {
    let run = await getRun(message.run_id);
    if (!run) return { ok: false, error: "Run not found." };
    if (run.status !== BB2Model.RUN_STATUSES.WAITING_PROMPT) return { ok: true, accepted: false, ignored: true };
    if (run.conversation_id !== message.identity?.conversation_id) return { ok: false, error: "Conversation mismatch." };
    if (run.prompt_watch_id !== message.watch_id) return { ok: false, error: "Prompt watch generation mismatch." };
    if (run.consumed_assistant_turn_id === message.assistant_turn_id) return { ok: true, accepted: false, ignored: true };
    const length = BB2Protocol.codePointLength(message.prompt_text);
    if (!message.prompt_text || length > BB2Protocol.MAX_PROMPT_CODE_POINTS) {
      run = BB2Model.pauseRun(BB2Model.evolveRun(run, { error: { code: "PROMPT_SIZE_INVALID", message: `Prompt length ${length}; max ${BB2Protocol.MAX_PROMPT_CODE_POINTS}.` } }));
      await saveRun(run);
      return { ok: true, paused: true, error: run.error.message };
    }
    const selection = await resolveNextIterationExecutor(run);
    run = await ensureRunExecutorChain(run, selection);
    const idempotency = BB2Protocol.jobIdempotencyKey(run, message.assistant_turn_id, message.prompt_text);
    run = BB2Model.evolveRun(run, {
      status: BB2Model.RUN_STATUSES.SUBMITTING_JOB,
      pending_submission: {
        idempotency_key: idempotency,
        assistant_turn_id: message.assistant_turn_id,
        prompt_text: message.prompt_text,
        prompt_fingerprint: message.prompt_fingerprint || BB2Protocol.fnv1a32(message.prompt_text)
      },
      error: null
    });
    await saveRun(run);
    schedulePoll(run.run_id, 0);
    return { ok: true, accepted: true };
  });
}

async function pauseActiveRun(identity, tabId, manualReason = null) {
  const active = await activeRunForContext(identity, tabId);
  if (!active) throw new Error("Активный run не найден.");
  return withRunLock(active.run_id, async () => {
    let run = await getRun(active.run_id);
    const decision = BB2ManualControls.pauseDecision(run);
    if (!decision.allowed) throw new Error("Текущий run нельзя поставить на паузу.");
    await tabMessage(run.tab_id, { type: "BB2_STOP_PROMPT_WATCH" }, 5000).catch(() => null);
    if (decision.mode === "already_paused") {
      return { run_id: run.run_id, status: run.status, pause_pending: run.pause_requested === true };
    }
    if (decision.mode === "deferred") {
      run = BB2Model.requestPauseAfterDelivery(run, "operator");
      await saveRun(run);
      await diagnostic("OPERATOR_PAUSE_DEFERRED", {
        run_id: run.run_id,
        status: run.status,
        job_id: run.current_job_id || null,
        reason: manualReason || "operator_pause"
      });
      return { run_id: run.run_id, status: run.status, pause_pending: true };
    }
    const token = await tokenForSnapshot(run.profile_snapshot);
    await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/pause`, {
      method: "POST",
      run_id: run.run_id,
      body: { client_id: run.client_installation_id, reason: manualReason || "operator_pause" }
    }).catch(() => null);
    run = BB2Model.pauseRun(run, "operator");
    await saveRun(run);
    await diagnostic("OPERATOR_PAUSE_APPLIED", { run_id: run.run_id, status: run.status });
    return { run_id: run.run_id, status: run.status, pause_pending: false };
  });
}

async function resumeActiveRun(identity, tabId) {
  const active = await activeRunForContext(identity, tabId);
  if (!active) throw new Error("Активный run не найден.");
  return withRunLock(active.run_id, async () => {
    let run = await getRun(active.run_id);
    if (run.status !== BB2Model.RUN_STATUSES.PAUSED) return { run_id: run.run_id, status: run.status };
    if (run.pause_reason && run.pause_reason !== "operator") throw new Error("Run остановлен из-за ошибки и требует проверки.");
    const token = await tokenForSnapshot(run.profile_snapshot);
    await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/resume`, { method: "POST", body: { client_id: run.client_installation_id } });
    run = BB2Model.resumeRun(run);
    await saveRun(run);
    if (run.status === BB2Model.RUN_STATUSES.WAITING_PROMPT) await beginPromptWatch(run);
    else schedulePoll(run.run_id, 0);
    return { run_id: run.run_id, status: run.status };
  });
}

async function stopActiveRun(identity, tabId) {
  const active = await activeRunForContext(identity, tabId);
  if (!active) throw new Error("Активный run не найден.");
  return withRunLock(active.run_id, async () => {
    let run = await getRun(active.run_id);
    const token = await tokenForSnapshot(run.profile_snapshot);
    await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/terminate`, { method: "POST", body: { client_id: run.client_installation_id, reason: "operator_finish" } }).catch(() => null);
    run = BB2Model.stopRun(run);
    await saveRun(run);
    if (pollTimers.has(run.run_id)) clearTimeout(pollTimers.get(run.run_id));
    pollTimers.delete(run.run_id);
    await tabMessage(run.tab_id, { type: "BB2_TERMINATE_RUN", run_id: run.run_id }, 5000).catch(() => null);
    await diagnostic("RUN_HARD_STOPPED", { run_id: run.run_id, chain_id: run.chain_id, job_id: run.current_job_id || null });
    setTimeout(() => { garbageCollectRuns().then(() => garbageCollectCredentials()).catch(() => null); }, 0);
    return { run_id: run.run_id, status: run.status };
  });
}
