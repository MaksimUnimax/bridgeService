(() => {
  "use strict";

  const NODE_IDS = new WeakMap();
  let nextNodeId = 1;

  class ComposerSendError extends Error {
    constructor(code, message = code) {
      super(message);
      this.name = "ComposerSendError";
      this.code = code;
    }
  }

  function nodeId(node) {
    if (!node || (typeof node !== "object" && typeof node !== "function")) return null;
    if (!NODE_IDS.has(node)) NODE_IDS.set(node, `node-${nextNodeId++}`);
    return NODE_IDS.get(node);
  }

  function normalize(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim().replace(/\s+/g, " ");
  }

  function snapshotTarget(target, deps) {
    const context = target?.context || null;
    const button = target?.button || null;
    const composer = context?.composer || null;
    const form = context?.form || null;
    const candidates = typeof deps?.candidateButtons === "function" ? deps.candidateButtons(context) : [];
    return {
      button_node_id: nodeId(button),
      composer_node_id: nodeId(composer),
      form_node_id: nodeId(form),
      button_connected: Boolean(button?.isConnected),
      button_disabled: button instanceof HTMLButtonElement ? Boolean(button.disabled) : false,
      button_aria_disabled: button?.getAttribute?.("aria-disabled") || null,
      button_visible: Boolean(button && deps?.visible?.(button)),
      composer_connected: Boolean(composer?.isConnected),
      composer_visible: Boolean(composer && deps?.visible?.(composer)),
      form_connected: Boolean(form?.isConnected),
      same_form: Boolean(button && composer && form && button.closest?.("form") === form && composer.closest?.("form") === form),
      candidate_send_buttons: Array.isArray(candidates) ? candidates.length : 0,
      button_fingerprint: typeof deps?.fingerprint === "function" ? deps.fingerprint(button) : null
    };
  }

  function validateTarget(target, expectedText, deps) {
    if (!target?.context || !target?.button) return { ok: false, code: "SEND_TARGET_INCOMPLETE" };
    const { context, button } = target;
    const { composer, form } = context;
    if (!composer?.isConnected) return { ok: false, code: "COMPOSER_DETACHED" };
    if (!form?.isConnected) return { ok: false, code: "COMPOSER_FORM_DETACHED" };
    if (!button?.isConnected) return { ok: false, code: "BUTTON_DETACHED" };
    if (!deps.visible(composer)) return { ok: false, code: "COMPOSER_NOT_VISIBLE" };
    if (!deps.visible(button)) return { ok: false, code: "BUTTON_NOT_VISIBLE" };
    if (button instanceof HTMLButtonElement && button.disabled) return { ok: false, code: "BUTTON_DISABLED" };
    if (button.getAttribute("aria-disabled") === "true") return { ok: false, code: "BUTTON_ARIA_DISABLED" };
    if (composer.closest("form") !== form || button.closest("form") !== form) return { ok: false, code: "BUTTON_COMPOSER_FORM_MISMATCH" };
    const composerValue = normalize(deps.readComposerText(composer));
    if (expectedText === null) {
      if (!composerValue) return { ok: false, code: "COMPOSER_EMPTY" };
    } else if (composerValue !== normalize(expectedText)) {
      return { ok: false, code: "COMPOSER_TEXT_CHANGED" };
    }
    return { ok: true };
  }

  async function waitForValidatedTarget({ expectedText, timeoutMs = 10000, sampleIntervalMs = 100, requiredStableSamples = 3, deps }) {
    const deadline = Date.now() + timeoutMs;
    let stableSamples = 0;
    let previousKey = null;
    while (Date.now() < deadline) {
      const context = deps.resolveContext();
      const button = context ? deps.resolveButton(context) : null;
      const target = context && button ? { context, button } : null;
      const validation = validateTarget(target, expectedText, deps);
      if (validation.ok) {
        const key = `${nodeId(context.composer)}|${nodeId(context.form)}|${nodeId(button)}`;
        stableSamples = key === previousKey ? stableSamples + 1 : 1;
        previousKey = key;
        if (stableSamples >= requiredStableSamples) {
          return { ...target, stable_samples: stableSamples, snapshot: snapshotTarget(target, deps) };
        }
      } else {
        stableSamples = 0;
        previousKey = null;
      }
      await deps.sleep(sampleIntervalMs);
    }
    return null;
  }

  function createClickTrace(context, button) {
    const trace = {
      document_capture_seen: false,
      button_capture_seen: false,
      button_bubble_seen: false,
      form_submit_seen: false,
      click_is_trusted: null,
      click_default_prevented: null,
      submit_default_prevented: null
    };
    let clickEvent = null;
    let submitEvent = null;
    const onDocumentCapture = (event) => {
      if (event.target === button || button.contains?.(event.target)) {
        trace.document_capture_seen = true;
        clickEvent = event;
        trace.click_is_trusted = event.isTrusted;
      }
    };
    const onButtonCapture = (event) => {
      trace.button_capture_seen = true;
      clickEvent = event;
      trace.click_is_trusted = event.isTrusted;
    };
    const onButtonBubble = (event) => {
      trace.button_bubble_seen = true;
      clickEvent = event;
    };
    const onSubmitCapture = (event) => {
      trace.form_submit_seen = true;
      submitEvent = event;
    };
    document.addEventListener("click", onDocumentCapture, true);
    button.addEventListener("click", onButtonCapture, true);
    button.addEventListener("click", onButtonBubble, false);
    context.form.addEventListener("submit", onSubmitCapture, true);
    return {
      finish() {
        trace.click_default_prevented = clickEvent ? clickEvent.defaultPrevented : null;
        trace.submit_default_prevented = submitEvent ? submitEvent.defaultPrevented : null;
        document.removeEventListener("click", onDocumentCapture, true);
        button.removeEventListener("click", onButtonCapture, true);
        button.removeEventListener("click", onButtonBubble, false);
        context.form.removeEventListener("submit", onSubmitCapture, true);
        return trace;
      }
    };
  }

  function clickSynchronously({ target, expectedText, deps, beforeClick = null }) {
    const validation = validateTarget(target, expectedText, deps);
    if (!validation.ok) throw new ComposerSendError(validation.code, validation.code);
    const preClickSnapshot = snapshotTarget(target, deps);
    if (typeof beforeClick === "function") beforeClick(preClickSnapshot);
    const trace = createClickTrace(target.context, target.button);
    const method = "button.click";
    target.button.click();
    const clickTrace = trace.finish();
    return {
      method_called: true,
      method,
      pre_click_snapshot: preClickSnapshot,
      trace: clickTrace,
      click_event_observed: Boolean(clickTrace.document_capture_seen || clickTrace.button_capture_seen || clickTrace.button_bubble_seen)
    };
  }

  globalThis.BB2ComposerSend = Object.freeze({
    ComposerSendError,
    nodeId,
    normalize,
    snapshotTarget,
    validateTarget,
    waitForValidatedTarget,
    clickSynchronously
  });
})();
