(() => {
  "use strict";

  const RUN_STATUSES = Object.freeze({
    STARTING: "starting",
    WAITING_PROMPT: "waiting_prompt",
    SUBMITTING_JOB: "submitting_job",
    WAITING_JOB: "waiting_job",
    DELIVERY_READY: "delivery_ready",
    DELIVERY_CLAIMED: "delivery_claimed",
    DELIVERY_COMMITTED: "delivery_committed",
    PAUSED: "paused",
    STOPPED: "stopped",
    ERROR: "error"
  });

  const DELIVERY_PHASES = Object.freeze({
    NONE: "none",
    CLAIMED: "claimed",
    COMMITTED: "committed",
    CONFIRMED: "confirmed"
  });

  function createRun({ runId, clientId, tabId, windowId, identity, profileSnapshot, executorId, chainId, conversationRef }) {
    const now = new Date().toISOString();
    return {
      schema_version: 1,
      state_revision: 1,
      run_id: runId,
      client_installation_id: clientId,
      tab_id: tabId,
      window_id: windowId,
      origin: identity?.origin || "",
      conversation_id: identity?.conversation_id || null,
      conversation_ref: conversationRef,
      conversation_key: globalThis.BB2Protocol.conversationKey(identity),
      profile_snapshot: { ...profileSnapshot },
      executor_id: executorId,
      chain_id: chainId,
      sequence: 0,
      status: RUN_STATUSES.STARTING,
      resume_status: null,
      pause_requested: false,
      pause_reason: null,
      submission_origin: null,
      pause_after_delivery: false,
      manual_one_shot: false,
      manual_request_id: null,
      anchor_turn_id: null,
      prompt_watch_id: null,
      assistant_baseline_ids: [],
      start_delivery: {
        phase: "none",
        previous_user_turn_id: null,
        committed_at: null
      },
      consumed_assistant_turn_id: null,
      current_job_id: null,
      current_job_revision: 0,
      delivery: {
        phase: DELIVERY_PHASES.NONE,
        delivery_id: null,
        job_id: null,
        report_hash: null,
        report_text: null,
        report_mode: null,
        committed_at: null,
        confirmed_user_turn_id: null,
        confirmed_receipt_id: null
      },
      error: null,
      retry_state: {
        start: 0,
        submit: 0,
        poll: 0,
        delivery: 0
      },
      created_at: now,
      updated_at: now
    };
  }

  function evolveRun(run, patch) {
    return {
      ...run,
      ...patch,
      state_revision: Number(run.state_revision || 0) + 1,
      updated_at: new Date().toISOString()
    };
  }

  function commitStart(run, previousUserTurnId) {
    if (run.start_delivery?.phase === "committed") return run;
    if (run.status !== RUN_STATUSES.STARTING) throw new Error("Start can only be committed while starting.");
    return evolveRun(run, {
      start_delivery: {
        phase: "committed",
        previous_user_turn_id: previousUserTurnId || null,
        committed_at: new Date().toISOString()
      }
    });
  }

  function confirmStart(run, { origin, conversationId, conversationRef, conversationKey, promptWatchId, assistantBaselineIds }) {
    if (run.start_delivery?.phase !== "committed") throw new Error("Start must be committed before confirmation.");
    return evolveRun(run, {
      status: RUN_STATUSES.WAITING_PROMPT,
      origin: origin || run.origin,
      conversation_id: conversationId,
      conversation_ref: conversationRef || conversationId,
      conversation_key: conversationKey,
      anchor_turn_id: null,
      prompt_watch_id: promptWatchId,
      assistant_baseline_ids: Array.isArray(assistantBaselineIds) ? [...assistantBaselineIds] : [],
      start_delivery: { ...run.start_delivery, phase: "confirmed" },
      error: null
    });
  }

  function pauseRun(run, reason = null) {
    if ([RUN_STATUSES.STOPPED, RUN_STATUSES.ERROR].includes(run.status)) return run;
    if (run.status === RUN_STATUSES.PAUSED) {
      return evolveRun(run, {
        pause_requested: false,
        pause_reason: reason || run.pause_reason || null
      });
    }
    return evolveRun(run, {
      status: RUN_STATUSES.PAUSED,
      resume_status: run.status,
      pause_requested: false,
      pause_reason: reason || run.pause_reason || null
    });
  }

  function requestPauseAfterDelivery(run, reason = "operator") {
    if ([RUN_STATUSES.STOPPED, RUN_STATUSES.ERROR].includes(run.status)) return run;
    return evolveRun(run, { pause_requested: true, pause_reason: reason });
  }

  function resumeRun(run) {
    if (run.status !== RUN_STATUSES.PAUSED) return run;
    return evolveRun(run, {
      status: run.resume_status || RUN_STATUSES.WAITING_PROMPT,
      resume_status: null,
      pause_requested: false,
      pause_reason: null,
      pause_after_delivery: false,
      submission_origin: null,
      manual_request_id: null
    });
  }

  function stopRun(run) {
    return evolveRun(run, {
      status: RUN_STATUSES.STOPPED,
      resume_status: null,
      pause_requested: false,
      pause_after_delivery: false,
      submission_origin: null
    });
  }

  function claimDelivery(run, payload) {
    // A committed delivery is irreversible. A confirmed delivery belongs to a completed
    // iteration and may be replaced by the next distinct job's delivery claim.
    if (run.delivery?.phase === DELIVERY_PHASES.COMMITTED) {
      throw new Error("Committed delivery cannot be replaced.");
    }
    return evolveRun(run, {
      status: RUN_STATUSES.DELIVERY_CLAIMED,
      delivery: {
        phase: DELIVERY_PHASES.CLAIMED,
        delivery_id: payload.delivery_id,
        job_id: payload.job_id,
        report_hash: payload.report_hash,
        report_text: payload.report_text,
        report_mode: payload.report_mode || "text",
        committed_at: null,
        confirmed_user_turn_id: null,
        confirmed_receipt_id: null
      }
    });
  }

  function commitDelivery(run) {
    if (run.delivery?.phase === DELIVERY_PHASES.CONFIRMED) return run;
    if (run.delivery?.phase !== DELIVERY_PHASES.CLAIMED) throw new Error("Delivery must be claimed before commit.");
    return evolveRun(run, {
      status: RUN_STATUSES.DELIVERY_COMMITTED,
      delivery: {
        ...run.delivery,
        phase: DELIVERY_PHASES.COMMITTED,
        committed_at: new Date().toISOString()
      }
    });
  }



  function confirmDelivery(run, { promptWatchId, assistantBaselineIds, receiptId }) {
    if (![DELIVERY_PHASES.COMMITTED, DELIVERY_PHASES.CONFIRMED].includes(run.delivery?.phase)) {
      throw new Error("Only committed delivery can be confirmed.");
    }
    return evolveRun(run, {
      status: RUN_STATUSES.WAITING_PROMPT,
      anchor_turn_id: null,
      prompt_watch_id: promptWatchId,
      assistant_baseline_ids: Array.isArray(assistantBaselineIds) ? [...assistantBaselineIds] : [],
      current_job_id: null,
      current_job_revision: 0,
      sequence: Number(run.sequence || 0) + 1,
      error: null,
      delivery: {
        ...run.delivery,
        phase: DELIVERY_PHASES.CONFIRMED,
        confirmed_user_turn_id: null,
        confirmed_receipt_id: receiptId || null,
        report_text: null
      }
    });
  }

  function setRetryAttempt(run, area, attempt, error = null) {
    const retryState = { ...(run.retry_state || {}) };
    retryState[area] = Math.max(0, Number(attempt || 0));
    return evolveRun(run, {
      retry_state: retryState,
      error: error || null
    });
  }

  function clearRetryAttempt(run, area) {
    const retryState = { ...(run.retry_state || {}) };
    retryState[area] = 0;
    return evolveRun(run, { retry_state: retryState, error: null });
  }

  function pauseForManualAction(run, error, resumeStatus = null) {
    if (run.status === RUN_STATUSES.PAUSED) {
      return evolveRun(run, {
        pause_requested: false,
        pause_reason: "manual_action",
        error: error || run.error || null
      });
    }
    return evolveRun(run, {
      status: RUN_STATUSES.PAUSED,
      resume_status: resumeStatus || run.status,
      pause_requested: false,
      pause_reason: "manual_action",
      error: error || null
    });
  }

  function resolveProfileForConversation({ bindingProfileId, defaultProfileId, profiles, bindingExists }) {
    if (bindingExists) {
      if (!bindingProfileId || !profiles[bindingProfileId]) {
        return { ok: false, code: "BOUND_PROFILE_UNAVAILABLE", profile: null };
      }
      return { ok: true, source: "conversation_binding", profile: profiles[bindingProfileId] };
    }
    if (defaultProfileId && profiles[defaultProfileId]) {
      return { ok: true, source: "default_profile", profile: profiles[defaultProfileId] };
    }
    return { ok: false, code: "NO_PROFILE_SELECTED", profile: null };
  }

  globalThis.BB2Model = {
    RUN_STATUSES,
    DELIVERY_PHASES,
    createRun,
    evolveRun,
    commitStart,
    confirmStart,
    pauseRun,
    requestPauseAfterDelivery,
    resumeRun,
    stopRun,
    claimDelivery,
    commitDelivery,
    confirmDelivery,
    setRetryAttempt,
    clearRetryAttempt,
    pauseForManualAction,
    resolveProfileForConversation
  };
})();
