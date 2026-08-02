async function getRun(runId) {
  if (!runId) return null;
  const data = await storageGet(RUN_PREFIX + runId);
  return data[RUN_PREFIX + runId] || null;
}

async function listRuns() {
  const index = await getRunIndex();
  const data = index.length ? await storageGet(index.map((id) => RUN_PREFIX + id)) : {};
  return index.map((id) => data[RUN_PREFIX + id]).filter(Boolean);
}

async function withRunLock(runId, fn) {
  const prior = runLocks.get(runId) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chain = prior.then(() => gate);
  runLocks.set(runId, chain);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (runLocks.get(runId) === chain) runLocks.delete(runId);
  }
}

async function withStorageLock(name, fn) {
  const prior = storageLocks.get(name) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chain = prior.then(() => gate);
  storageLocks.set(name, chain);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (storageLocks.get(name) === chain) storageLocks.delete(name);
  }
}

const singleFlight = BB2Protocol.singleFlight;

function errorRecord(error, fallbackCode) {
  return {
    code: error?.code || fallbackCode,
    message: error?.message || "Business Bridge operation failed.",
    status: Number(error?.status || 0) || null,
    request_id: error?.request_id || error?.payload?.request_id || null
  };
}

async function transportStateForProfile(profileId) {
  if (!profileId) return BB2Transport.initial();
  if (transportMemo.has(profileId)) return transportMemo.get(profileId);
  const data = await storageGet(KEYS.TRANSPORT_STATES);
  const state = (data[KEYS.TRANSPORT_STATES] || {})[profileId] || BB2Transport.initial();
  transportMemo.set(profileId, state);
  return state;
}

async function updateTransportState(profileId, reducer, { persistAlways = true } = {}) {
  if (!profileId) return { previous: BB2Transport.initial(), next: BB2Transport.initial() };
  return withStorageLock(`transport:${profileId}`, async () => {
    const data = await storageGet(KEYS.TRANSPORT_STATES);
    const states = { ...(data[KEYS.TRANSPORT_STATES] || {}) };
    const previous = transportMemo.get(profileId) || states[profileId] || BB2Transport.initial();
    const next = reducer(previous);
    transportMemo.set(profileId, next);
    const lastPersistedMs = Date.parse(states[profileId]?.last_success_at || states[profileId]?.last_failure_at || 0) || 0;
    const shouldPersist = persistAlways || !states[profileId] || Date.now() - lastPersistedMs >= 30000;
    if (shouldPersist) {
      states[profileId] = next;
      await storageSet({ [KEYS.TRANSPORT_STATES]: states });
    }
    return { previous, next };
  });
}

async function runsUsingProfile(profileId) {
  if (!profileId) return [];
  const runs = await listRuns();
  return runs.filter((run) => run.profile_snapshot?.profile_id === profileId && ![
    BB2Model.RUN_STATUSES.STOPPED,
    BB2Model.RUN_STATUSES.ERROR
  ].includes(run.status));
}

async function notifyTransportTransition(profile, previous, next) {
  if (!profile?.profile_id || previous.state === next.state) return;
  const runs = await runsUsingProfile(profile.profile_id);
  if (next.state === BB2Transport.STATES.DISCONNECTED) {
    await diagnostic("BRIDGE_TRANSPORT_DISCONNECTED", {
      profile_id: profile.profile_id,
      endpoint: profile.endpoint,
      last_success_at: next.last_success_at,
      retry_at: next.retry_at,
      code: next.last_error_code
    }, { level: "error" });
    await Promise.all(runs.map((run) => showRunStatus(
      run,
      `Business Bridge 2: соединение с сервером потеряно — ${BB2Protocol.normalizedEndpoint(profile.endpoint)}`,
      "error"
    )));
  } else if (next.state === BB2Transport.STATES.CONNECTED && previous.state === BB2Transport.STATES.DISCONNECTED) {
    await diagnostic("BRIDGE_TRANSPORT_RECOVERED", {
      profile_id: profile.profile_id,
      endpoint: profile.endpoint,
      last_success_at: next.last_success_at
    });
    await Promise.all(runs.map((run) => showRunStatus(
      run,
      "Business Bridge 2: соединение с сервером восстановлено.",
      "operator_success"
    )));
  }
}

async function markTransportConnected(profile) {
  if (!profile?.profile_id) return BB2Transport.initial();
  const { previous, next } = await updateTransportState(
    profile.profile_id,
    (state) => BB2Transport.markConnected(state),
    { persistAlways: (await transportStateForProfile(profile.profile_id)).state !== BB2Transport.STATES.CONNECTED }
  );
  await notifyTransportTransition(profile, previous, next);
  return next;
}

async function markTransportDisconnected(profile, error) {
  if (!profile?.profile_id) return BB2Transport.initial();
  const { previous, next } = await updateTransportState(
    profile.profile_id,
    (state) => BB2Transport.markDisconnected(state, error),
    { persistAlways: true }
  );
  await notifyTransportTransition(profile, previous, next);
  return next;
}

function retryAttempt(run, area) {
  return Math.max(0, Number(run?.retry_state?.[area] || 0)) + 1;
}

async function scheduleTransientRetry(run, area, error, event, { baseMs = 2000, maxMs = 60000, maxAttempts = 0 } = {}) {
  const attempt = retryAttempt(run, area);
  const record = errorRecord(error, `${area.toUpperCase()}_RETRY`);
  if (maxAttempts > 0 && attempt > maxAttempts) {
    const paused = BB2Model.pauseForManualAction(run, { ...record, code: `${record.code}_RETRY_LIMIT` }, run.status);
    await saveRun(paused);
    await diagnostic(`${event}_PAUSED`, { run_id: paused.run_id, area, attempt, code: record.code, status: record.status, request_id: record.request_id });
    await showRunStatus(paused, `Business Bridge 2: автоматические повторы остановлены — ${record.message}`, "error");
    return paused;
  }
  const next = BB2Model.setRetryAttempt(run, area, attempt, record);
  await saveRun(next);
  const delay = ["NETWORK_ERROR", "BRIDGE_TIMEOUT"].includes(record.code)
    ? BB2Transport.nextDelay(attempt)
    : BB2Protocol.retryDelayMs(attempt, baseMs, maxMs);
  await diagnostic(event, { run_id: next.run_id, area, attempt, delay_ms: delay, code: record.code, status: record.status, request_id: record.request_id });
  schedulePoll(next.run_id, delay);
  return next;
}

async function pauseForPermanentFailure(run, area, error, event, resumeStatus = null) {
  const record = errorRecord(error, `${area.toUpperCase()}_BLOCKED`);
  const paused = BB2Model.pauseForManualAction(run, record, resumeStatus || run.status);
  await saveRun(paused);
  await diagnostic(event, { run_id: paused.run_id, area, code: record.code, status: record.status, request_id: record.request_id });
  await showRunStatus(paused, `Business Bridge 2: требуется проверка — ${record.message}`, "error");
  return paused;
}

async function failRun(run, area, error, event) {
  const record = errorRecord(error, `${area.toUpperCase()}_FAILED`);
  const failed = BB2Model.evolveRun(run, { status: BB2Model.RUN_STATUSES.ERROR, resume_status: null, error: record });
  await saveRun(failed);
  await diagnostic(event, { run_id: failed.run_id, area, code: record.code, status: record.status, request_id: record.request_id });
  await showRunStatus(failed, `Business Bridge 2: run остановлен — ${record.message}`, "error");
  return failed;
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    profile_id: profile.profile_id,
    profile_revision: profile.profile_revision,
    name: profile.name,
    endpoint: profile.endpoint,
    bridge_instance_id: profile.bridge_instance_id,
    api_contract: profile.api_contract,
    deployment_revision: profile.deployment_revision || "",
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", ...extra };
}

async function responseTextLimited(response, limitBytes) {
  const advertised = Number(response.headers.get("Content-Length") || 0);
  if (advertised && advertised > limitBytes) {
    const error = new Error("Bridge response exceeds the allowed size.");
    error.code = "BRIDGE_RESPONSE_TOO_LARGE";
    throw error;
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limitBytes) {
      const error = new Error("Bridge response exceeds the allowed size.");
      error.code = "BRIDGE_RESPONSE_TOO_LARGE";
      throw error;
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel().catch(() => null);
      const error = new Error("Bridge response exceeds the allowed size.");
      error.code = "BRIDGE_RESPONSE_TOO_LARGE";
      throw error;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function httpPathDiagnostic(path) {
  const clean = String(path || "").split("?")[0];
  const chain = clean.match(/\/v2\/chains\/([^/]+)/);
  const job = clean.match(/\/v2\/jobs\/([^/]+)/);
  return {
    path_template: clean
      .replace(/\/v2\/chains\/[^/]+/, "/v2/chains/:chain_id")
      .replace(/\/v2\/jobs\/[^/]+/, "/v2/jobs/:job_id"),
    chain_id: chain ? decodeURIComponent(chain[1]) : undefined,
    job_id: job ? decodeURIComponent(job[1]) : undefined
  };
}

async function bridgeFetch(snapshotOrProfile, token, path, options = {}) {
  const endpoint = BB2Protocol.normalizedEndpoint(snapshotOrProfile.endpoint);
  const method = options.method || "GET";
  const requestTraceId = uuid("http");
  const started = performance.now();
  const route = httpPathDiagnostic(path);
  const logContext = {
    request_trace_id: requestTraceId,
    method,
    endpoint,
    profile_id: snapshotOrProfile.profile_id || null,
    bridge_instance_id: snapshotOrProfile.bridge_instance_id || null,
    run_id: options.run_id || null,
    ...route
  };
  await diagnostic("HTTP_REQUEST_STARTED", logContext, { level: "debug" });
  const controller = new AbortController();
  const timeoutMs = options.timeout_ms || HTTP_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method,
      headers: authHeaders(token, options.body === undefined ? {} : { "Content-Type": "application/json" }),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store"
    });
    await markTransportConnected(snapshotOrProfile).catch(() => null);
    const text = await responseTextLimited(response, options.max_response_bytes || DEFAULT_RESPONSE_LIMIT_BYTES);
    const responseBytes = new TextEncoder().encode(text).byteLength;
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); } catch (_) { payload = { raw: text.slice(0, 1000) }; }
    }
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || `Bridge HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.code || "BRIDGE_HTTP_ERROR";
      error.payload = payload;
      error.request_id = payload.request_id || null;
      throw error;
    }
    await diagnostic("HTTP_REQUEST_FINISHED", {
      ...logContext,
      status: response.status,
      duration_ms: Math.round((performance.now() - started) * 10) / 10,
      response_bytes: responseBytes,
      server_request_id: payload.request_id || null
    }, { level: "debug" });
    return payload;
  } catch (sourceError) {
    let error = sourceError;
    if (sourceError?.name === "AbortError") {
      error = new Error("Bridge request timed out.");
      error.code = "BRIDGE_TIMEOUT";
    } else if ((sourceError instanceof TypeError || sourceError?.name === "TypeError") && !sourceError.code) {
      error = new Error(sourceError.message || "Bridge network request failed.");
      error.code = "NETWORK_ERROR";
    }
    await diagnostic("HTTP_REQUEST_FAILED", {
      ...logContext,
      duration_ms: Math.round((performance.now() - started) * 10) / 10,
      timeout_ms: timeoutMs,
      status: error.status || null,
      code: error.code || "HTTP_REQUEST_FAILED",
      server_request_id: error.request_id || null,
      message: error.message
    }, { level: "error" });
    if (["NETWORK_ERROR", "BRIDGE_TIMEOUT"].includes(error.code)) {
      await markTransportDisconnected(snapshotOrProfile, error).catch(() => null);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
