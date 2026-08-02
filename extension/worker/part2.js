function validateFocusPolicy(value) {
  const policy = String(value || "report_only");
  if (!["off", "report_only", "always"].includes(policy)) throw new Error("Некорректная политика активации вкладки.");
  return policy;
}

function validateAttachmentRecord(record) {
  if (!record) return null;
  const fileName = String(record.file_name || "").trim();
  const dataUrl = String(record.data_url || "");
  const sizeBytes = Number(record.size_bytes || 0);
  if (!fileName || !dataUrl.startsWith("data:")) throw new Error("Файл контекста имеет неверный формат.");
  const commaIndex = dataUrl.indexOf(",");
  const encodedLength = commaIndex >= 0 ? dataUrl.length - commaIndex - 1 : dataUrl.length;
  const estimatedBytes = /;base64,/i.test(dataUrl) ? Math.floor(encodedLength * 3 / 4) : encodedLength;
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_CONTEXT_ATTACHMENT_BYTES || estimatedBytes > MAX_CONTEXT_ATTACHMENT_BYTES + 16) {
    throw new Error("Файл контекста превышает лимит 8 МБ.");
  }
  return {
    file_name: fileName.slice(0, 220),
    mime_type: String(record.mime_type || "application/octet-stream").slice(0, 160),
    size_bytes: sizeBytes,
    data_url: dataUrl,
    interval: Math.max(1, Math.min(999, Number(record.interval || 1))),
    delivered_count: Math.max(0, Number(record.delivered_count || 0)),
    last_attached_at_count: Math.max(0, Number(record.last_attached_at_count || 0)),
    updated_at: record.updated_at || new Date().toISOString()
  };
}

function validateReportPrefixRecord(record) {
  if (!record) return null;
  const text = String(record.text || "").replace(/\r\n?/g, "\n");
  const enabled = record.enabled === true;
  if (enabled && !text.trim()) throw new Error("Включённый префикс отчёта не может быть пустым.");
  return {
    enabled,
    text,
    interval: Math.max(1, Math.min(999, Number(record.interval || 1))),
    delivered_count: Math.max(0, Number(record.delivered_count || 0)),
    last_applied_at_count: Math.max(0, Number(record.last_applied_at_count || 0)),
    updated_at: record.updated_at || new Date().toISOString()
  };
}

function reportPrefixIsDue(record) {
  if (record?.enabled !== true || !String(record.text || "").trim()) return false;
  const delivered = Math.max(0, Number(record.delivered_count || 0));
  const last = Math.max(0, Number(record.last_applied_at_count || 0));
  const interval = Math.max(1, Number(record.interval || 1));
  return delivered - last >= interval - 1;
}

function applyReportPrefix(outgoingText, record) {
  if (!reportPrefixIsDue(record)) return { text: String(outgoingText || ""), applied: false };
  return { text: `${String(record.text || "")}\n\n${String(outgoingText || "")}`, applied: true };
}

async function saveConversationSettings(identity, tabId, payload) {
  return withStorageLock("conversation_settings", async () => {
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
    const focusPolicy = validateFocusPolicy(payload.focus_policy);
    const nextConfig = {
      executor_id: String(payload.executor_id || "") || null,
      focus_policy: focusPolicy,
      wait_for_selected_executor: payload.wait_for_selected_executor !== false,
      updated_at: new Date().toISOString()
    };
    nextConfigs[key] = nextConfig;
    focusPolicies[key] = focusPolicy;
    resourcePolicies[key] = nextConfig.wait_for_selected_executor;

    if (payload.attachment) {
      const normalized = validateAttachmentRecord({
        ...payload.attachment,
        interval: payload.attachment_interval,
        delivered_count: attachments[key]?.delivered_count || 0,
        last_attached_at_count: attachments[key]?.last_attached_at_count || 0,
        updated_at: new Date().toISOString()
      });
      attachments[key] = normalized;
    } else if (attachments[key]) {
      attachments[key] = {
        ...attachments[key],
        interval: Math.max(1, Math.min(999, Number(payload.attachment_interval || attachments[key].interval || 1))),
        updated_at: new Date().toISOString()
      };
    }

    const currentPrefix = prefixes[key] || null;
    const normalizedPrefix = validateReportPrefixRecord({
      enabled: payload.report_prefix_enabled === true,
      text: String(payload.report_prefix_text ?? currentPrefix?.text ?? ""),
      interval: payload.report_prefix_interval,
      delivered_count: currentPrefix?.delivered_count || 0,
      last_applied_at_count: currentPrefix?.last_applied_at_count || 0,
      updated_at: new Date().toISOString()
    });
    if (normalizedPrefix && (normalizedPrefix.enabled || normalizedPrefix.text)) prefixes[key] = normalizedPrefix;
    else delete prefixes[key];

    await storageSet({
      [KEYS.NEXT_ITERATION_CONFIGS]: nextConfigs,
      [KEYS.FOCUS_POLICIES]: focusPolicies,
      [KEYS.RESOURCE_POLICIES]: resourcePolicies,
      [KEYS.REPORT_ATTACHMENTS]: attachments,
      [KEYS.REPORT_PREFIXES]: prefixes
    });
    return { key, next: nextConfig, attachment: attachments[key] || null, report_prefix: prefixes[key] || null };
  });
}


async function promotePendingConversationSettings(tabId, identity) {
  const realKey = BB2Protocol.conversationKey(identity);
  if (!realKey) return false;
  const pendingKey = `pending-tab:${String(tabId)}`;
  if (pendingKey === realKey) return false;
  await withStorageLock("conversation_settings", async () => {
    const data = await storageGet([
      KEYS.NEXT_ITERATION_CONFIGS,
      KEYS.FOCUS_POLICIES,
      KEYS.RESOURCE_POLICIES,
      KEYS.REPORT_ATTACHMENTS,
      KEYS.REPORT_PREFIXES,
      KEYS.MANUAL_MODES
    ]);
    const mappings = [
      [KEYS.NEXT_ITERATION_CONFIGS, data[KEYS.NEXT_ITERATION_CONFIGS] || {}],
      [KEYS.FOCUS_POLICIES, data[KEYS.FOCUS_POLICIES] || {}],
      [KEYS.RESOURCE_POLICIES, data[KEYS.RESOURCE_POLICIES] || {}],
      [KEYS.REPORT_ATTACHMENTS, data[KEYS.REPORT_ATTACHMENTS] || {}],
      [KEYS.REPORT_PREFIXES, data[KEYS.REPORT_PREFIXES] || {}],
      [KEYS.MANUAL_MODES, data[KEYS.MANUAL_MODES] || {}]
    ];
    const updates = {};
    for (const [storageKey, map] of mappings) {
      if (Object.prototype.hasOwnProperty.call(map, pendingKey) && !Object.prototype.hasOwnProperty.call(map, realKey)) {
        map[realKey] = map[pendingKey];
      }
      delete map[pendingKey];
      updates[storageKey] = map;
    }
    await storageSet(updates);
  });
  return true;
}

async function clearConversationAttachment(identity, tabId) {
  return withStorageLock("conversation_settings", async () => {
    const key = conversationSettingsKey(identity, tabId);
    const data = await storageGet(KEYS.REPORT_ATTACHMENTS);
    const attachments = data[KEYS.REPORT_ATTACHMENTS] || {};
    delete attachments[key];
    await storageSet({ [KEYS.REPORT_ATTACHMENTS]: attachments });
    return true;
  });
}

function attachmentIsDue(record) {
  if (!record?.file_name || !record?.data_url) return false;
  const delivered = Math.max(0, Number(record.delivered_count || 0));
  const last = Math.max(0, Number(record.last_attached_at_count || 0));
  const interval = Math.max(1, Number(record.interval || 1));
  return delivered - last >= interval - 1;
}

async function noteConfirmedReportFeatures(run, attachmentUploaded, reportPrefixApplied) {
  const identity = { origin: run.origin, conversation_id: run.conversation_id };
  const key = conversationSettingsKey(identity, run.tab_id);
  await withStorageLock("conversation_settings", async () => {
    const data = await storageGet([KEYS.REPORT_ATTACHMENTS, KEYS.REPORT_PREFIXES]);
    const attachments = data[KEYS.REPORT_ATTACHMENTS] || {};
    const prefixes = data[KEYS.REPORT_PREFIXES] || {};
    const attachment = attachments[key];
    const prefix = prefixes[key];
    if (attachment) {
      const deliveredCount = Math.max(0, Number(attachment.delivered_count || 0)) + 1;
      attachments[key] = {
        ...attachment,
        delivered_count: deliveredCount,
        last_attached_at_count: attachmentUploaded ? deliveredCount : Math.max(0, Number(attachment.last_attached_at_count || 0)),
        updated_at: new Date().toISOString()
      };
    }
    if (prefix) {
      const deliveredCount = Math.max(0, Number(prefix.delivered_count || 0)) + 1;
      prefixes[key] = {
        ...prefix,
        delivered_count: deliveredCount,
        last_applied_at_count: reportPrefixApplied ? deliveredCount : Math.max(0, Number(prefix.last_applied_at_count || 0)),
        updated_at: new Date().toISOString()
      };
    }
    await storageSet({ [KEYS.REPORT_ATTACHMENTS]: attachments, [KEYS.REPORT_PREFIXES]: prefixes });
  });
}

async function getRunIndex() {
  const data = await storageGet(KEYS.RUN_INDEX);
  return Array.isArray(data[KEYS.RUN_INDEX]) ? data[KEYS.RUN_INDEX] : [];
}

async function saveRun(run) {
  let transition = null;
  let blockedByHardStop = null;
  const saved = await withStorageLock("run_index", async () => {
    const index = await getRunIndex();
    const existingData = await storageGet(RUN_PREFIX + run.run_id);
    const previous = existingData[RUN_PREFIX + run.run_id] || null;
    if (previous?.status === BB2Model.RUN_STATUSES.STOPPED && run.status !== BB2Model.RUN_STATUSES.STOPPED) {
      blockedByHardStop = {
        run_id: run.run_id,
        attempted_status: run.status,
        previous_status: previous.status,
        job_id: run.current_job_id || null
      };
      return previous;
    }
    if (!index.includes(run.run_id)) index.push(run.run_id);
    await storageSet({ [RUN_PREFIX + run.run_id]: run, [KEYS.RUN_INDEX]: index });
    const changed = !previous || previous.status !== run.status || previous.current_job_id !== run.current_job_id || previous.sequence !== run.sequence || previous.chain_id !== run.chain_id;
    if (changed) {
      transition = {
        run_id: run.run_id,
        previous_status: previous?.status || null,
        status: run.status,
        chain_id: run.chain_id || null,
        job_id: run.current_job_id || null,
        sequence: Number(run.sequence || 0),
        executor_id: run.executor_id || null,
        profile_id: run.profile_snapshot?.profile_id || null,
        error_code: run.error?.code || null
      };
    }
    return run;
  });
  if (blockedByHardStop) {
    await diagnostic("STALE_CALLBACK_BLOCKED_AFTER_HARD_STOP", blockedByHardStop, { level: "warning" });
    const error = new Error("Run is hard stopped; stale callback cannot change its state.");
    error.code = "RUN_HARD_STOPPED";
    throw error;
  }
  if (transition) await diagnostic("RUN_STATE_CHANGED", transition, { level: transition.error_code ? "warning" : "info" });
  return saved;
}

async function garbageCollectRuns({ maxTerminal = 100, maxAgeDays = 30 } = {}) {
  return withStorageLock("run_index", async () => {
    const index = await getRunIndex();
    if (!index.length) return 0;
    const data = await storageGet(index.map((id) => RUN_PREFIX + id));
    const now = Date.now();
    const terminal = [];
    const keep = new Set();
    for (const id of index) {
      const run = data[RUN_PREFIX + id];
      if (!run) continue;
      if (![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status)) {
        keep.add(id);
        continue;
      }
      terminal.push(run);
    }
    terminal.sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0));
    terminal.forEach((run, position) => {
      const age = now - Date.parse(run.updated_at || run.created_at || 0);
      if (position < maxTerminal && Number.isFinite(age) && age <= maxAgeDays * 86400000) keep.add(run.run_id);
    });
    const removeIds = index.filter((id) => !keep.has(id));
    if (removeIds.length) {
      await storageRemove(removeIds.map((id) => RUN_PREFIX + id));
      await storageSet({ [KEYS.RUN_INDEX]: index.filter((id) => keep.has(id)) });
    }
    return removeIds.length;
  });
}
