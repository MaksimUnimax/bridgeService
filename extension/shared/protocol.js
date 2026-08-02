(() => {
  "use strict";

  const API_CONTRACT = "business-bridge-v2";
  const START_MESSAGE = "поехали";
  const MAX_PROMPT_CODE_POINTS = 50000;
  const TEXT_REPORT_LIMIT = 40000;
  const JOB_POLL_MS = 2500;
  const RECOVERY_ALARM_MINUTES = 0.5;
  const PROFILE_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
  const RETRYABLE_HTTP_STATUSES = Object.freeze([408, 425, 429, 500, 502, 503, 504]);
  const NON_RETRYABLE_CODES = Object.freeze([
    "AUTH_REQUIRED", "AUTH_INVALID", "TOKEN_INVALID", "INSTANCE_ID_INVALID",
    "IDEMPOTENCY_CONFLICT", "SEQUENCE_CONFLICT", "EXECUTOR_MISMATCH",
    "CHAIN_TERMINATED", "CHAIN_PAUSED", "DELIVERY_OWNED",
    "DELIVERY_NOT_COMMITTED", "CONFIRMATION_CONFLICT",
    "NOT_FOUND", "METHOD_NOT_ALLOWED", "REQUEST_TOO_LARGE",
    "INVALID_REQUEST", "INVALID_JSON", "INVALID_ID",
    "DELIVERY_INTEGRITY_ERROR", "DELIVERY_IDENTITY_MISMATCH",
    "CONVERSATION_MISMATCH", "BOUND_PROFILE_UNAVAILABLE"
  ]);

  function codePointLength(value) {
    return Array.from(String(value || "")).length;
  }

  function fnv1a32(value) {
    let hash = 0x811c9dc5;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function normalizedEndpoint(value) {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    const parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Endpoint должен использовать http или https.");
    if (!parsed.hostname) throw new Error("Endpoint не содержит hostname.");
    if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname.toLowerCase())) {
      throw new Error("Bridge endpoint должен быть локальным SSH tunnel: 127.0.0.1, localhost или ::1.");
    }
    if (parsed.username || parsed.password) throw new Error("Credentials нельзя помещать в URL.");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  }

  function conversationKey(identity) {
    if (!identity?.origin || !identity?.conversation_id) return null;
    return `${String(identity.origin).toLowerCase()}|${String(identity.conversation_id).toLowerCase()}`;
  }

  function temporaryConversationRef(clientId, tabId, nonce) {
    return `pending:${clientId}:${tabId}:${nonce}`;
  }

  function profileSnapshot(profile) {
    if (!profile) throw new Error("Bridge profile missing.");
    return Object.freeze({
      profile_id: profile.profile_id,
      profile_revision: profile.profile_revision,
      name: profile.name,
      endpoint: profile.endpoint,
      credential_ref: profile.credential_ref,
      bridge_instance_id: profile.bridge_instance_id,
      api_contract: profile.api_contract,
      deployment_revision: profile.deployment_revision || ""
    });
  }





  function singleFlight(map, key, fn) {
    if (map.has(key)) return map.get(key);
    const request = Promise.resolve().then(fn).finally(() => {
      if (map.get(key) === request) map.delete(key);
    });
    map.set(key, request);
    return request;
  }

  function bridgeErrorDisposition(status, code, stage = "generic") {
    const numericStatus = Number(status || 0);
    const stableCode = String(code || "").toUpperCase();
    if (RETRYABLE_HTTP_STATUSES.includes(numericStatus)) return "retry";
    if (!numericStatus && ["BRIDGE_TIMEOUT", "NETWORK_ERROR", "CONTENT_ADAPTER_UNAVAILABLE"].includes(stableCode)) return "retry";
    if (stage === "delivery_after_commit") return "pause";
    if (stableCode === "DELIVERY_OWNED" || stableCode === "CONFIRMATION_CONFLICT") return "pause";
    if (NON_RETRYABLE_CODES.includes(stableCode)) return "fatal";
    if (numericStatus >= 400 && numericStatus < 500) return "fatal";
    return "retry";
  }

  function retryDelayMs(attempt, baseMs = 2000, maxMs = 60000) {
    const safeAttempt = Math.max(1, Math.min(10, Number(attempt || 1)));
    return Math.min(maxMs, baseMs * (2 ** (safeAttempt - 1)));
  }

  function jobIdempotencyKey(run, assistantTurnId, promptText) {
    return [run.run_id, run.sequence, assistantTurnId, fnv1a32(promptText)].join(":");
  }

  globalThis.BB2Protocol = {
    API_CONTRACT,
    START_MESSAGE,
    MAX_PROMPT_CODE_POINTS,
    TEXT_REPORT_LIMIT,
    JOB_POLL_MS,
    RECOVERY_ALARM_MINUTES,
    PROFILE_ID_RE,
    RETRYABLE_HTTP_STATUSES,
    NON_RETRYABLE_CODES,
    codePointLength,
    fnv1a32,
    normalizedEndpoint,
    conversationKey,
    temporaryConversationRef,
    singleFlight,
    bridgeErrorDisposition,
    retryDelayMs,
    profileSnapshot,
    jobIdempotencyKey
  };
})();
