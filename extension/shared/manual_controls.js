(() => {
  "use strict";

  const BUSY_STATUSES = Object.freeze(new Set([
    "starting",
    "submitting_job",
    "waiting_job",
    "delivery_ready",
    "delivery_claimed",
    "delivery_committed"
  ]));

  function isBusyRun(run) {
    if (!run) return false;
    return BUSY_STATUSES.has(String(run.status || "")) || Boolean(run.pending_submission) || Boolean(run.current_job_id);
  }

  function isOperatorPausedIdle(run) {
    return Boolean(run) &&
      run.status === "paused" &&
      run.pause_reason === "operator" &&
      !run.pause_requested &&
      !run.pending_submission &&
      !run.current_job_id;
  }

  function strictBindingRecord({ conversationKey, bindings, pending, tabId }) {
    const safeBindings = bindings || {};
    const safePending = pending || {};
    if (conversationKey && Object.prototype.hasOwnProperty.call(safeBindings, conversationKey)) {
      return { exists: true, profileId: safeBindings[conversationKey] || null, source: "conversation" };
    }
    if (Object.prototype.hasOwnProperty.call(safePending, String(tabId))) {
      return { exists: true, profileId: safePending[String(tabId)] || null, source: "pending_tab" };
    }
    return { exists: false, profileId: null, source: null };
  }

  function strictBindingProfileId(input) {
    return strictBindingRecord(input).profileId;
  }

  function manualButtonDecision({
    bindingExists,
    profileExists,
    credentialExists,
    transportState,
    executorId,
    run
  }) {
    if (!bindingExists) return { visible: false, enabled: false, code: "NO_BINDING", label: "В CLI", title: "" };
    const base = { visible: true, enabled: false, label: "В CLI" };
    if (!profileExists) return { ...base, code: "BOUND_PROFILE_UNAVAILABLE", title: "Привязанный Bridge-профиль недоступен." };
    if (!credentialExists) return { ...base, code: "BOUND_CREDENTIAL_UNAVAILABLE", title: "Token привязанного Bridge-профиля отсутствует." };
    if (transportState !== "connected") return { ...base, code: "BRIDGE_CONNECTION_UNAVAILABLE", title: "Нет подтверждённого соединения с Bridge." };
    if (!executorId) return { ...base, code: "NO_EXECUTOR_SELECTED", title: "CLI для следующей итерации не выбрана." };
    if (!run) return { ...base, enabled: true, code: "MANUAL_READY", title: `Отправить этот writing block в ${executorId}.` };
    if (run.pause_requested === true) return { ...base, code: "PAUSE_PENDING", title: "Пауза будет включена после получения и доставки текущего отчёта." };
    if (isOperatorPausedIdle(run)) return { ...base, enabled: true, code: "MANUAL_READY_PAUSED", title: `Отправить этот writing block в ${executorId}; run останется на паузе.` };
    if (run.status === "paused") return { ...base, code: "SAFETY_PAUSED", title: "Run остановлен из-за ошибки и требует проверки." };
    if (isBusyRun(run)) return { ...base, code: "RUN_BUSY", title: "Bridge уже выполняет или доставляет задачу." };
    if (run.status === "waiting_prompt") return { ...base, code: "AUTO_MODE_ACTIVE", title: "Авторабота включена. Нажмите «Пауза» для ручной отправки." };
    return { ...base, code: "RUN_STATE_UNAVAILABLE", title: "Текущее состояние run не разрешает ручную отправку." };
  }

  function pauseDecision(run) {
    if (!run) return { allowed: false, mode: "none", code: "RUN_NOT_FOUND" };
    if (["stopped", "error"].includes(run.status)) return { allowed: false, mode: "none", code: "RUN_TERMINAL" };
    if (run.status === "paused") return { allowed: true, mode: "already_paused", code: "ALREADY_PAUSED" };
    if (run.status === "waiting_prompt" && !run.current_job_id && !run.pending_submission) {
      return { allowed: true, mode: "immediate", code: "PAUSE_NOW" };
    }
    return { allowed: true, mode: "deferred", code: "PAUSE_AFTER_DELIVERY" };
  }

  function postDeliveryDecision(run) {
    if (!run) return "continue";
    if (run.manual_one_shot === true) return "stop_one_shot";
    if (run.pause_requested === true || run.pause_after_delivery === true) return "pause";
    return "continue";
  }

  function manualRequestIdempotencyKey(runId, requestId) {
    return `${String(runId || "manual")}:manual:${String(requestId || "")}`;
  }

  function ancestorDistance(node, ancestor) {
    let distance = 0;
    let current = node;
    while (current && current !== ancestor) {
      current = current.parentElement || null;
      distance += 1;
    }
    return current === ancestor ? distance : Number.POSITIVE_INFINITY;
  }

  function sharedAncestorWithin(left, right, boundary) {
    if (!left || !right || !boundary) return null;
    const rightAncestors = new Set();
    let current = right;
    while (current) {
      rightAncestors.add(current);
      if (current === boundary) break;
      current = current.parentElement || null;
    }
    current = left;
    while (current) {
      if (rightAncestors.has(current)) return current;
      if (current === boundary) break;
      current = current.parentElement || null;
    }
    return null;
  }

  function chooseLocalWritingBlockCopyButton(section, explicitRoot, copies) {
    const candidates = Array.isArray(copies) ? copies.filter(Boolean) : [];
    if (!section || candidates.length === 0) return null;

    if (!explicitRoot) {
      return candidates.length === 1 ? candidates[0] : null;
    }

    const inside = candidates.filter((copy) => typeof explicitRoot.contains === "function" && explicitRoot.contains(copy));
    if (inside.length === 1) return inside[0];
    if (inside.length > 1) return null;

    const ranked = candidates
      .map((copy) => {
        const shared = sharedAncestorWithin(explicitRoot, copy, section);
        if (!shared || shared === section) return null;
        const score = ancestorDistance(explicitRoot, shared) + ancestorDistance(copy, shared);
        return Number.isFinite(score) ? { copy, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    if (ranked.length === 0) return null;
    const bestScore = ranked[0].score;
    const best = ranked.filter((entry) => entry.score === bestScore);
    return best.length === 1 ? best[0].copy : null;
  }


  const MANUAL_COPY_ADAPTER_IDS = Object.freeze({
    LEGACY_CODE_BLOCK: "legacy_code_block_v1",
    CURRENT_WRITING_BLOCK: "current_writing_block_v1"
  });
  const BUILTIN_MANUAL_COPY_ADAPTER_COUNT = 2;
  const MAX_CUSTOM_COPY_BUTTON_PROFILES = 24;

  function boundedString(value, max = 240) {
    return String(value || "").slice(0, max);
  }

  function copyButtonProfileKey(profile) {
    if (!profile) return "";
    return [
      profile.adapter_id || "",
      profile.tag || "",
      profile.testid || "",
      profile.aria || "",
      profile.title || "",
      profile.name || "",
      profile.type || "",
      profile.text_hint || ""
    ].join("\u001f");
  }

  function normalizeCopyButtonProfile(raw) {
    if (!raw || typeof raw !== "object") return null;
    const legacy = raw.kind === "bb2_manual_copy_button_v1";
    const current = raw.kind === "bb2_manual_copy_button_v2";
    if (!legacy && !current) return null;
    const adapterId = boundedString(
      raw.adapter_id || (raw.requires_code_block_viewer === true ? MANUAL_COPY_ADAPTER_IDS.LEGACY_CODE_BLOCK : ""),
      80
    );
    if (!Object.values(MANUAL_COPY_ADAPTER_IDS).includes(adapterId)) return null;
    const tag = boundedString(raw.tag || "button", 40).toLowerCase();
    if (tag !== "button") return null;
    const normalized = {
      kind: "bb2_manual_copy_button_v2",
      profile_id: boundedString(raw.profile_id, 120),
      adapter_id: adapterId,
      tag,
      testid: boundedString(raw.testid, 240),
      aria: boundedString(raw.aria, 240),
      title: boundedString(raw.title, 240),
      name: boundedString(raw.name, 240),
      type: boundedString(raw.type, 80),
      text_hint: boundedString(raw.text_hint, 120),
      created_at: boundedString(raw.created_at, 80)
    };
    if (![normalized.testid, normalized.aria, normalized.title, normalized.name, normalized.type, normalized.text_hint].some(Boolean)) {
      return null;
    }
    return normalized;
  }

  function normalizeCopyButtonProfileCollection(raw) {
    const source = raw?.kind === "bb2_manual_copy_profiles_v2"
      ? raw.profiles
      : (Array.isArray(raw) ? raw : (raw ? [raw] : []));
    const profiles = [];
    const seen = new Set();
    for (const entry of Array.isArray(source) ? source : []) {
      const normalized = normalizeCopyButtonProfile(entry);
      if (!normalized) continue;
      const key = copyButtonProfileKey(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      profiles.push(normalized);
      if (profiles.length >= MAX_CUSTOM_COPY_BUTTON_PROFILES) break;
    }
    return {
      kind: "bb2_manual_copy_profiles_v2",
      version: 2,
      profiles
    };
  }

  function mergeCopyButtonProfileCollections(current, incoming) {
    const left = normalizeCopyButtonProfileCollection(current).profiles;
    const right = normalizeCopyButtonProfileCollection(incoming).profiles;
    return normalizeCopyButtonProfileCollection({
      kind: "bb2_manual_copy_profiles_v2",
      profiles: [...left, ...right]
    });
  }

  globalThis.BB2ManualControls = Object.freeze({
    BUSY_STATUSES,
    isBusyRun,
    isOperatorPausedIdle,
    strictBindingRecord,
    strictBindingProfileId,
    manualButtonDecision,
    pauseDecision,
    postDeliveryDecision,
    manualRequestIdempotencyKey,
    ancestorDistance,
    sharedAncestorWithin,
    chooseLocalWritingBlockCopyButton,
    MANUAL_COPY_ADAPTER_IDS,
    BUILTIN_MANUAL_COPY_ADAPTER_COUNT,
    MAX_CUSTOM_COPY_BUTTON_PROFILES,
    copyButtonProfileKey,
    normalizeCopyButtonProfile,
    normalizeCopyButtonProfileCollection,
    mergeCopyButtonProfileCollections
  });
})();
