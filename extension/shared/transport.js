(() => {
  "use strict";
  const STATES = Object.freeze({ UNKNOWN: "unknown", CONNECTED: "connected", DISCONNECTED: "disconnected", RECOVERING: "recovering" });
  const RETRY_DELAYS_MS = Object.freeze([5000, 10000, 20000, 40000, 60000]);
  function initial() {
    return { state: STATES.UNKNOWN, last_success_at: null, last_failure_at: null, last_error_code: null, last_error_message: null, retry_at: null, failure_count: 0 };
  }
  function nextDelay(failureCount) {
    const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Number(failureCount || 1) - 1));
    return RETRY_DELAYS_MS[index];
  }
  function markConnected(previous, at = new Date().toISOString()) {
    const before = previous || initial();
    return { state: STATES.CONNECTED, last_success_at: at, last_failure_at: before.last_failure_at || null, last_error_code: null, last_error_message: null, retry_at: null, failure_count: 0 };
  }
  function markDisconnected(previous, error = {}, at = new Date().toISOString(), nowMs = Date.now()) {
    const before = previous || initial();
    const failureCount = Number(before.failure_count || 0) + 1;
    return {
      state: STATES.DISCONNECTED,
      last_success_at: before.last_success_at || null,
      last_failure_at: at,
      last_error_code: String(error.code || "NETWORK_ERROR"),
      last_error_message: String(error.message || "Failed to fetch"),
      retry_at: new Date(nowMs + nextDelay(failureCount)).toISOString(),
      failure_count: failureCount
    };
  }
  function publicState(value) {
    const state = value || initial();
    return {
      state: state.state,
      last_success_at: state.last_success_at,
      last_failure_at: state.last_failure_at,
      last_error_code: state.last_error_code,
      last_error_message: state.last_error_message,
      retry_at: state.retry_at,
      failure_count: state.failure_count
    };
  }
  globalThis.BB2Transport = Object.freeze({ STATES, RETRY_DELAYS_MS, initial, nextDelay, markConnected, markDisconnected, publicState });
})();
