async function claimJobDelivery(run, job) {
  const token = await tokenForSnapshot(run.profile_snapshot);
  let payload;
  try {
    payload = await bridgeFetch(run.profile_snapshot, token, `/v2/jobs/${encodeURIComponent(job.job_id)}/delivery/claim`, {
      method: "POST",
      run_id: run.run_id,
      body: { client_id: run.client_installation_id, run_id: run.run_id },
      timeout_ms: 30000,
      max_response_bytes: DELIVERY_RESPONSE_LIMIT_BYTES
    });
  } catch (error) {
    error.bridge_stage = "delivery_claim";
    throw error;
  }
  if (payload.job_id !== job.job_id) throw Object.assign(new Error("Bridge delivery job mismatch."), { code: "DELIVERY_IDENTITY_MISMATCH", bridge_stage: "delivery_claim" });
  if (!payload.delivery_id || !["claimed", "committed", "confirmed"].includes(payload.state)) {
    throw Object.assign(new Error("Bridge returned an invalid delivery state."), { code: "DELIVERY_INTEGRITY_ERROR", bridge_stage: "delivery_claim" });
  }
  const reportText = String(payload.report_text || "");
  if (!reportText || !payload.report_hash) throw Object.assign(new Error("Bridge delivery report is unavailable."), { code: "DELIVERY_INTEGRITY_ERROR", bridge_stage: "delivery_claim" });
  const actualHash = await sha256Hex(reportText);
  if (actualHash !== String(payload.report_hash).toLowerCase()) throw Object.assign(new Error("Bridge delivery report hash mismatch."), { code: "DELIVERY_INTEGRITY_ERROR", bridge_stage: "delivery_claim" });
  const attachment = BB2Protocol.codePointLength(reportText) > BB2Protocol.TEXT_REPORT_LIMIT;
  const attachmentName = `business-bridge-report-${job.job_id}.md`;
  const outgoingText = attachment
    ? `Business Bridge 2: полный отчёт задачи ${job.job_id} приложен файлом ${attachmentName}. SHA-256: ${payload.report_hash}`
    : reportText;
  return {
    delivery_id: payload.delivery_id,
    job_id: job.job_id,
    state: payload.state,
    report_hash: payload.report_hash,
    report_text: reportText,
    report_mode: attachment ? "attachment" : "text",
    attachment_name: attachmentName,
    outgoing_text: outgoingText,
    confirmed_user_turn_id: payload.confirmed_user_turn_id || null
  };
}

async function currentPromptBaseline(run) {
  const response = await tabMessage(run.tab_id, { type: "BB2_GET_PROMPT_BASELINE" }, 5000);
  if (!response.ok) throw Object.assign(new Error(response.error || "Prompt baseline unavailable."), { code: response.code || "PROMPT_BASELINE_UNAVAILABLE" });
  return Array.isArray(response.assistant_baseline_ids) ? response.assistant_baseline_ids : [];
}

function promptWatchId(run, suffix) {
  return `watch:${run.run_id}:${Number(run.sequence || 0)}:${String(suffix || crypto.randomUUID())}`;
}

async function applyPostDeliveryMode(run) {
  const decision = BB2ManualControls.postDeliveryDecision(run);
  if (decision === "continue") return run;
  const token = await tokenForSnapshot(run.profile_snapshot);
  if (decision === "pause") {
    await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/pause`, {
      method: "POST",
      run_id: run.run_id,
      body: { client_id: run.client_installation_id, reason: "operator_pause_after_delivery" }
    }).catch(() => null);
    const cleared = BB2Model.evolveRun(run, {
      pause_requested: false,
      pause_after_delivery: false,
      submission_origin: null
    });
    return BB2Model.pauseRun(cleared, "operator");
  }
  await bridgeFetch(run.profile_snapshot, token, `/v2/chains/${encodeURIComponent(run.chain_id)}/terminate`, {
    method: "POST",
    run_id: run.run_id,
    body: { client_id: run.client_installation_id, reason: "manual_one_shot_complete" }
  }).catch(() => null);
  return BB2Model.stopRun(BB2Model.evolveRun(run, {
    pause_requested: false,
    pause_after_delivery: false,
    submission_origin: null
  }));
}

async function finishDelivery(runId, response) {
  await withRunLock(runId, async () => {
    let run = await getRun(runId);
    if (!run) return;
    if (run.status === BB2Model.RUN_STATUSES.STOPPED) {
      await diagnostic("DELIVERY_RESPONSE_IGNORED_AFTER_HARD_STOP", { run_id: run.run_id }, { level: "warning" });
      return;
    }
    if (!response.ok || response.composer_empty !== true) {
      const error = Object.assign(new Error(response.error || "Composer did not become empty after Send."), {
        code: response.code || "COMPOSER_SEND_INCOMPLETE"
      });
      if (run.delivery?.phase === BB2Model.DELIVERY_PHASES.COMMITTED) {
        await pauseForPermanentFailure(run, "delivery", error, "DELIVERY_SEND_STOPPED_AFTER_COMMIT", run.status);
      } else {
        await scheduleTransientRetry(run, "delivery", error, "DELIVERY_ATTEMPT_RETRY", { baseMs: 3000, maxMs: 60000, maxAttempts: 12 });
      }
      return;
    }

    const assistantBaselineIds = Array.isArray(response.assistant_baseline_ids)
      ? response.assistant_baseline_ids
      : await currentPromptBaseline(run);
    const receiptId = `composer-empty:${run.delivery.delivery_id}`;
    const nextWatchId = promptWatchId(run, run.delivery.delivery_id);
    const wasStopped = run.status === BB2Model.RUN_STATUSES.STOPPED;
    const wasPaused = run.status === BB2Model.RUN_STATUSES.PAUSED;
    const token = await tokenForSnapshot(run.profile_snapshot);
    await bridgeFetch(run.profile_snapshot, token, `/v2/jobs/${encodeURIComponent(run.delivery.job_id)}/delivery/confirm`, {
      method: "POST",
      run_id: run.run_id,
      body: {
        delivery_id: run.delivery.delivery_id,
        client_id: run.client_installation_id,
        run_id: run.run_id,
        user_turn_id: receiptId
      },
      max_response_bytes: DEFAULT_RESPONSE_LIMIT_BYTES
    });
    const previousChainSequence = Number(run.chain_sequence ?? run.sequence ?? 0);
    const finishedJobId = run.delivery?.job_id || run.current_job_id || null;
    run = BB2Model.confirmDelivery(run, {
      promptWatchId: nextWatchId,
      assistantBaselineIds,
      receiptId
    });
    run.chain_sequence = previousChainSequence + 1;
    run.last_job_id = finishedJobId;
    run.retry_state = { ...(run.retry_state || {}), delivery: 0, poll: 0 };
    if (wasStopped) run = BB2Model.stopRun(run);
    else if (wasPaused) run = BB2Model.pauseRun(run, run.pause_reason || null);
    run = await applyPostDeliveryMode(run);
    const reportPrefixApplied = run.delivery?.report_prefix_applied === true;
    run.delivery.outgoing_text = null;
    run.delivery.attachment_name = null;
    run.delivery.report_prefix_applied = false;
    await saveRun(run);
    await noteConfirmedReportFeatures(run, response.context_attachment_uploaded === true, reportPrefixApplied).catch(() => null);
    await diagnostic("DELIVERY_COMPOSER_EMPTIED", {
      run_id: run.run_id,
      job_id: run.delivery.job_id,
      receipt_id: receiptId,
      click_attempts: Number(response.click_attempts || 0),
      context_attachment_uploaded: response.context_attachment_uploaded === true,
      report_prefix_applied: reportPrefixApplied
    });
    await showRunStatus(run,
      run.status === BB2Model.RUN_STATUSES.WAITING_PROMPT
        ? "Business Bridge 2: отчёт отправлен. Жду следующий writing block."
        : "Business Bridge 2: отчёт отправлен; текущий run остаётся на паузе или завершён.",
      "operator_success"
    );
    if (run.status === BB2Model.RUN_STATUSES.WAITING_PROMPT) await beginPromptWatch(run);
  });
}

async function prepareClaimedDeliveryPayload(runId) {
  return withRunLock(runId, async () => {
    let run = await getRun(runId);
    if (!run || run.delivery?.phase !== BB2Model.DELIVERY_PHASES.CLAIMED) return null;
    const token = await tokenForSnapshot(run.profile_snapshot);
    const payload = await bridgeFetch(run.profile_snapshot, token, `/v2/jobs/${encodeURIComponent(run.delivery.job_id)}/delivery/claim`, {
      method: "POST",
      run_id: run.run_id,
      body: { client_id: run.client_installation_id, run_id: run.run_id },
      timeout_ms: 30000,
      max_response_bytes: DELIVERY_RESPONSE_LIMIT_BYTES
    });
    if (payload.job_id !== run.delivery.job_id || payload.delivery_id !== run.delivery.delivery_id) {
      throw Object.assign(new Error("Bridge delivery identity mismatch during recovery."), { code: "DELIVERY_IDENTITY_MISMATCH", bridge_stage: "delivery_recovery" });
    }
    const reportText = String(payload.report_text || "");
    if (!reportText || !payload.report_hash) throw Object.assign(new Error("Bridge delivery reconciliation material is unavailable."), { code: "DELIVERY_INTEGRITY_ERROR", bridge_stage: "delivery_recovery" });
    const actualHash = await sha256Hex(reportText);
    if (actualHash !== String(payload.report_hash).toLowerCase()) throw Object.assign(new Error("Bridge delivery report hash mismatch."), { code: "DELIVERY_INTEGRITY_ERROR", bridge_stage: "delivery_claim" });
    const attachment = BB2Protocol.codePointLength(reportText) > BB2Protocol.TEXT_REPORT_LIMIT;
    const attachmentName = `business-bridge-report-${run.delivery.job_id}.md`;
    const outgoingText = attachment
      ? `Business Bridge 2: полный отчёт задачи ${run.delivery.job_id} приложен файлом ${attachmentName}. SHA-256: ${payload.report_hash}`
      : reportText;
    run = BB2Model.evolveRun(run, {
      delivery: {
        ...run.delivery,
        report_hash: payload.report_hash,
        report_mode: attachment ? "attachment" : "text",
        outgoing_text: outgoingText,
        attachment_name: attachmentName,
        report_text: null
      }
    });
    if (["committed", "confirmed"].includes(payload.state)) {
      run = BB2Model.commitDelivery(run);
      if (payload.state === "confirmed") {
        const assistantBaselineIds = await currentPromptBaseline(run);
        run = BB2Model.confirmDelivery(run, {
          promptWatchId: promptWatchId(run, run.delivery.delivery_id || "recovered"),
          assistantBaselineIds,
          receiptId: payload.confirmed_user_turn_id || `server-confirmed:${run.delivery.delivery_id || "unknown"}`
        });
        run = await applyPostDeliveryMode(run);
      }
    }
    await saveRun(run);
    return { run, report_text: reportText, outgoing_text: outgoingText, attachment_name: attachmentName, server_state: payload.state };
  });
}

function attemptDelivery(runId) {
  return singleFlight(deliveryAttemptRequests, runId, () => attemptDeliveryCycle(runId));
}

async function attemptDeliveryCycle(runId) {
  let run = await getRun(runId);
  if (!run || [BB2Model.RUN_STATUSES.PAUSED, BB2Model.RUN_STATUSES.STOPPED].includes(run.status)) return;
  if (run.delivery?.phase !== BB2Model.DELIVERY_PHASES.CLAIMED) return;
  let ephemeralReportText = null;
  if (run.delivery.phase === BB2Model.DELIVERY_PHASES.CLAIMED) {
    const prepared = await prepareClaimedDeliveryPayload(runId);
    if (!prepared) return;
    run = prepared.run;
    ephemeralReportText = prepared.server_state === "claimed" ? prepared.report_text : null;
    if (run.delivery?.phase === BB2Model.DELIVERY_PHASES.CONFIRMED) {
      if (run.status === BB2Model.RUN_STATUSES.WAITING_PROMPT) await beginPromptWatch(run);
      return;
    }
  }
  try {
    await activateRunTab(run, "report");
    const liveIdentity = await tabIdentity(run.tab_id);
    if (!liveIdentity?.conversation_id || liveIdentity.conversation_id !== run.conversation_id) {
      throw Object.assign(new Error("Привязанная вкладка открыта на другом ChatGPT-диалоге."), { code: "CONVERSATION_MISMATCH" });
    }
    const conversationSettings = await getConversationSettings({ origin: run.origin, conversation_id: run.conversation_id }, run.tab_id);
    const contextAttachment = attachmentIsDue(conversationSettings.attachment) ? {
      file_name: conversationSettings.attachment.file_name,
      mime_type: conversationSettings.attachment.mime_type,
      size_bytes: conversationSettings.attachment.size_bytes,
      data_url: conversationSettings.attachment.data_url
    } : null;
    const prefixed = applyReportPrefix(run.delivery.outgoing_text, conversationSettings.report_prefix);
    run = BB2Model.evolveRun(run, {
      delivery: { ...run.delivery, report_prefix_applied: prefixed.applied }
    });
    await saveRun(run);

    const response = await tabMessage(run.tab_id, {
      type: "BB2_DELIVER_REPORT",
      run_id: run.run_id,
      conversation_id: run.conversation_id,
      delivery_id: run.delivery.delivery_id,
      report_hash: run.delivery.report_hash,
      report_text: ephemeralReportText,
      report_mode: run.delivery.report_mode,
      attachment_name: run.delivery.attachment_name,
      context_attachment: contextAttachment,
      outgoing_text: prefixed.text
    }, 600000);
    await finishDelivery(run.run_id, response);
  } catch (error) {
    run = await getRun(runId) || run;
    const stage = run.delivery?.phase === BB2Model.DELIVERY_PHASES.COMMITTED ? "delivery_after_commit" : "delivery_before_commit";
    const disposition = BB2Protocol.bridgeErrorDisposition(error.status, error.code, stage);
    if (disposition === "retry") {
      await scheduleTransientRetry(run, "delivery", error, "DELIVERY_RETRY_SCHEDULED", { baseMs: 5000, maxMs: 60000, maxAttempts: 12 });
    } else {
      await pauseForPermanentFailure(run, "delivery", error, "DELIVERY_MANUAL_ACTION_REQUIRED", run.status);
    }
  }
}

function pollRun(runId) {
  return singleFlight(runCycleRequests, runId, () => pollRunCycle(runId));
}

async function pollRunCycle(runId) {
  const run = await getRun(runId);
  if (!run || [BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status)) return;
  if (run.status === BB2Model.RUN_STATUSES.PAUSED) return;
  if (run.status === BB2Model.RUN_STATUSES.SUBMITTING_JOB) return submitPendingJob(runId);
  if ([BB2Model.RUN_STATUSES.DELIVERY_CLAIMED, BB2Model.RUN_STATUSES.DELIVERY_COMMITTED].includes(run.status)) {
    return attemptDelivery(runId);
  }
  if (run.status !== BB2Model.RUN_STATUSES.WAITING_JOB || !run.current_job_id) return;

  await withRunLock(runId, async () => {
    let current = await getRun(runId);
    if (!current || current.status !== BB2Model.RUN_STATUSES.WAITING_JOB) return;
    const token = await tokenForSnapshot(current.profile_snapshot);
    try {
      const job = await bridgeFetch(current.profile_snapshot, token, `/v2/jobs/${encodeURIComponent(current.current_job_id)}?after_revision=${Number(current.current_job_revision || 0)}`, { timeout_ms: 10000, run_id: current.run_id });
      current = BB2Model.evolveRun(current, {
        current_job_revision: Number(job.revision || current.current_job_revision || 0),
        retry_state: { ...(current.retry_state || {}), poll: 0 },
        error: null
      });
      await saveRun(current);
      if (["queued", "running"].includes(job.status)) {
        schedulePoll(current.run_id);
        return;
      }
      if (!["succeeded", "failed", "interrupted", "cancelled"].includes(job.status)) {
        schedulePoll(current.run_id, 5000);
        return;
      }
      const delivery = await claimJobDelivery(current, job);
      current = BB2Model.claimDelivery(current, {
        delivery_id: delivery.delivery_id,
        job_id: delivery.job_id,
        report_hash: delivery.report_hash,
        report_text: null,
        report_mode: delivery.report_mode
      });
      current.delivery.outgoing_text = delivery.outgoing_text;
      current.delivery.attachment_name = delivery.attachment_name;
      current.retry_state = { ...(current.retry_state || {}), poll: 0, delivery: 0 };
      if (["committed", "confirmed"].includes(delivery.state)) current = BB2Model.commitDelivery(current);
      if (delivery.state === "confirmed") {
        const assistantBaselineIds = await currentPromptBaseline(current);
        current = BB2Model.confirmDelivery(current, {
          promptWatchId: promptWatchId(current, delivery.delivery_id || "recovered"),
          assistantBaselineIds,
          receiptId: delivery.confirmed_user_turn_id || `server-confirmed:${delivery.delivery_id || "unknown"}`
        });
        current = await applyPostDeliveryMode(current);
      }
      await saveRun(current);
      await diagnostic("DELIVERY_CLAIMED", { run_id: current.run_id, job_id: current.current_job_id, delivery_id: delivery.delivery_id, mode: delivery.report_mode, server_state: delivery.state });
      if (current.status === BB2Model.RUN_STATUSES.WAITING_PROMPT) await beginPromptWatch(current);
      else schedulePoll(current.run_id, 0);
    } catch (error) {
      const stage = error.bridge_stage || "job_poll";
      const area = stage.startsWith("delivery") ? "delivery" : "poll";
      const disposition = BB2Protocol.bridgeErrorDisposition(error.status, error.code, stage);
      if (disposition === "retry") {
        await scheduleTransientRetry(current, area, error, stage.startsWith("delivery") ? "DELIVERY_CLAIM_RETRY" : "JOB_POLL_RETRY", {
          baseMs: stage.startsWith("delivery") ? 5000 : 2500,
          maxMs: 60000,
          maxAttempts: stage.startsWith("delivery") ? 12 : 0
        });
      } else {
        await pauseForPermanentFailure(current, area, error, stage.startsWith("delivery") ? "DELIVERY_CLAIM_BLOCKED" : "JOB_POLL_BLOCKED", current.status);
      }
    }
  });
}
