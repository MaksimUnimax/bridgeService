/* Business Bridge 2 content runtime — sequential classic-script parts. */
  "use strict";

  var VERSION = "2.0.0.21";
  var RUNTIME_KEY = "__BUSINESS_BRIDGE_2_CONTENT_RUNTIME__";
  var runtimeId = `${VERSION}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  var prior = globalThis[RUNTIME_KEY];
  if (prior?.dispose) {
    try { prior.dispose("superseded"); } catch (_) {}
  }

  var runtime = { id: runtimeId, disposed: false, dispose: null };
  globalThis[RUNTIME_KEY] = runtime;

  var STAGE_ATTR = "data-business-bridge-2-stage";
  var STAGE_DELIVERY_ATTR = "data-business-bridge-2-delivery";
  var PROMPT_STABILITY_MS = 2000;
  var PROMPT_DEBOUNCE_MS = 200;
  var SEND_RENDER_WAIT_MS = 2000;
  var SEND_TARGET_STABLE_SAMPLES = 3;
  var SEND_TARGET_SAMPLE_INTERVAL_MS = 200;
  var COMPOSER_SEND_RETRY_MS = 250;
  var MANUAL_INITIAL_BLOCK_LIMIT = 3;
  var MANUAL_INITIAL_NODE_LIMIT = 5000;

  var observer = null;
  var observerTimer = null;
  var activePromptWatch = null;
  var promptFirstSeen = null;
  var promptTickInFlight = false;
  var sendButtonProfile = null;
  var copyButtonProfiles = [];
  var pickerState = null;
  var copyPickerActive = false;
  var suppressPickerClick = false;
  var manualModeEnabled = false;
  var manualModeObserver = null;
  var manualModeFlushTimer = null;
  var manualModePendingRoots = new Set();
  var manualModeDecorations = new Map();
  var manualModeTrackedRoots = new Set();
  var manualModeTailRoot = null;
  var stoppedRunIds = new Set();

  function current() {
    return !runtime.disposed && globalThis[RUNTIME_KEY] === runtime;
  }

  function dispose(reason = "disposed") {
    if (runtime.disposed) return;
    runtime.disposed = true;
    runtime.reason = reason;
    stopPromptWatch();
    disableManualModeEnhancement("content_dispose");
    try { restorePicker(); } catch (_) { pickerState = null; copyPickerActive = false; }
    try {
      if (globalThis[RUNTIME_KEY] === runtime) delete globalThis[RUNTIME_KEY];
    } catch (_) {}
  }
  runtime.dispose = dispose;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function conversationIdFromPath(pathname) {
    const match = String(pathname || "").match(/(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function identity() {
    return {
      origin: location.origin,
      chat_path: location.pathname,
      conversation_id: conversationIdFromPath(location.pathname)
    };
  }

  async function waitForIdentity(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = identity();
      if (value.conversation_id) return value;
      await sleep(200);
    }
    return identity();
  }

  function sendRuntime(type, payload = {}) {
    return new Promise((resolve) => {
      if (!current()) return resolve({ ok: false, code: "CONTENT_RUNTIME_SUPERSEDED" });
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            if (/context invalidated/i.test(error.message || "")) dispose("context_invalidated");
            resolve({ ok: false, error: error.message || "Runtime message failed." });
            return;
          }
          resolve(response || { ok: false, error: "Empty response." });
        });
      } catch (error) {
        resolve({ ok: false, error: String(error?.message || error) });
      }
    });
  }


  function recordContentDiagnostic(event, details = {}) {
    sendRuntime("BB2_RECORD_DIAGNOSTIC", { event, details }).catch(() => null);
  }

  function sendButtonFingerprint(button) {
    if (!(button instanceof HTMLElement)) return "";
    return [
      button.tagName,
      button.getAttribute("data-testid") || "",
      button.getAttribute("aria-label") || "",
      button.getAttribute("title") || "",
      button.getAttribute("type") || "",
      button.getAttribute("name") || ""
    ].join("|");
  }

  function composerSendDeps() {
    return {
      resolveContext: primaryComposerContext,
      resolveButton: sendButton,
      candidateButtons: sendButtonCandidates,
      visible,
      readComposerText: composerText,
      fingerprint: sendButtonFingerprint,
      sleep
    };
  }

  async function waitForStableSendTarget(timeoutMs = 10000, expectedText = null) {
    return BB2ComposerSend.waitForValidatedTarget({
      expectedText,
      timeoutMs,
      sampleIntervalMs: SEND_TARGET_SAMPLE_INTERVAL_MS,
      requiredStableSamples: SEND_TARGET_STABLE_SAMPLES,
      deps: composerSendDeps()
    });
  }

  async function stabilizeComposerForSend(expectedText, area, details = {}) {
    const startedAt = Date.now();
    const minimumReadyAt = startedAt + SEND_RENDER_WAIT_MS;
    const deadline = startedAt + Math.max(8000, SEND_RENDER_WAIT_MS + 4000);
    let stableSamples = 0;
    let lastComposer = null;
    recordContentDiagnostic(`${area}_COMPOSER_STABILIZATION_STARTED`, {
      ...details,
      minimum_wait_ms: SEND_RENDER_WAIT_MS
    });
    while (Date.now() < deadline) {
      const context = primaryComposerContext();
      const exactText = Boolean(context) && normalizedDeliveryText(composerText(context.composer)) === normalizedDeliveryText(expectedText);
      if (context && exactText && context.composer.isConnected && context.form.isConnected) {
        stableSamples = context.composer === lastComposer ? stableSamples + 1 : 1;
        lastComposer = context.composer;
        if (Date.now() >= minimumReadyAt && stableSamples >= SEND_TARGET_STABLE_SAMPLES) {
          recordContentDiagnostic(`${area}_COMPOSER_STABILIZED`, {
            ...details,
            elapsed_ms: Date.now() - startedAt,
            stable_samples: stableSamples,
            composer_tag: context.composer.tagName,
            contenteditable: context.composer.getAttribute("contenteditable") || null
          });
          return context;
        }
      } else {
        stableSamples = 0;
        lastComposer = null;
      }
      await sleep(SEND_TARGET_SAMPLE_INTERVAL_MS);
    }
    recordContentDiagnostic(`${area}_COMPOSER_STABILIZATION_FAILED`, {
      ...details,
      elapsed_ms: Date.now() - startedAt,
      composer_present: Boolean(primaryComposerContext())
    });
    throw new Error("Нижнее поле ChatGPT не подтвердило устойчивое состояние после программной вставки текста.");
  }




  function showStatus(text, tone = "operator_work", id = null) {
    return BB2Toast.show({ text, tone, id });
  }

  BB2Toast.ensureRoot().addEventListener("bb2-toast-dismissed", (event) => {
    recordContentDiagnostic("TOAST_DISMISSED", { toast_id: event.detail?.toast_id || null });
  });

  function visible(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function insideAssistantEditor(node) {
    return Boolean(node?.closest?.(
      'section[data-turn="assistant"], [data-message-author-role="assistant"], [data-writing-block], [data-writing-block-id], #code-block-viewer'
    ));
  }

  function composerContextFromNode(node) {
    if (!(node instanceof HTMLElement) || !visible(node) || insideAssistantEditor(node)) return null;
    const form = node.closest("form");
    if (!form || insideAssistantEditor(form)) return null;
    return { composer: node, form };
  }

  function primaryComposerContext() {
    const selectors = [
      "#prompt-textarea",
      '[data-testid="prompt-textarea"]',
      'textarea[id*="prompt" i]',
      'textarea[data-testid*="prompt" i]',
      '[contenteditable="true"][id*="prompt" i]',
      '[contenteditable="true"][data-testid*="prompt" i]'
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const context = composerContextFromNode(node);
        if (!context) continue;
        let score = 0;
        if (node.id === "prompt-textarea") score += 1000;
        if ((node.getAttribute("data-testid") || "") === "prompt-textarea") score += 800;
        if (context.form.closest("#composer-background, [data-testid*='composer' i]")) score += 400;
        score += Math.min(200, node.getBoundingClientRect().top);
        candidates.push({ context, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.context || null;
  }

  function composerText(composer) {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) return composer.value || "";
    return composer.textContent || "";
  }

  function canonicalText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();
  }

  function normalizedDeliveryText(value) {
    return canonicalText(value).replace(/\s+/g, " ").trim();
  }

  function setComposerText(composer, text) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value");
      const setter = descriptor?.set;
      if (!setter) throw new Error("Composer value setter unavailable.");
      setter.call(composer, text);
    } else {
      composer.textContent = text;
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function buttonToken(button) {
    return [
      button.getAttribute("data-testid") || "",
      button.getAttribute("aria-label") || "",
      button.getAttribute("title") || "",
      button.getAttribute("name") || "",
      button.getAttribute("type") || "",
      button.textContent || ""
    ].join(" ").toLowerCase();
  }

  function manualButtonSignature(button) {
    const testid = button.getAttribute("data-testid") || "";
    const aria = button.getAttribute("aria-label") || "";
    const title = button.getAttribute("title") || "";
    const name = button.getAttribute("name") || "";
    return {
      kind: "bb2_manual_send_button_v1",
      tag: button.tagName.toLowerCase(),
      testid,
      aria,
      title,
      name,
      type: button.getAttribute("type") || "",
      text_hint: (testid || aria || title || name) ? "" : canonicalText(button.textContent || "").slice(0, 120),
      form_index: null
    };
  }

  function signatureMatchesButton(profile, button) {
    if (!profile || profile.kind !== "bb2_manual_send_button_v1" || !(button instanceof HTMLElement)) return false;
    if (profile.tag && button.tagName.toLowerCase() !== profile.tag) return false;
    for (const [key, attribute] of [["testid", "data-testid"], ["aria", "aria-label"], ["title", "title"], ["name", "name"], ["type", "type"]]) {
      if (profile[key] && (button.getAttribute(attribute) || "") !== profile[key]) return false;
    }
    if (profile.text_hint && canonicalText(button.textContent || "").slice(0, 120) !== profile.text_hint) return false;
    return true;
  }

  function manualSendButton(context) {
    if (!sendButtonProfile || !context?.form) return null;
    const candidates = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((button) => signatureMatchesButton(sendButtonProfile, button))
      .filter((button) => visible(button) && !insideAssistantEditor(button))
      .filter((button) => !(button instanceof HTMLButtonElement && button.disabled) && button.getAttribute("aria-disabled") !== "true");
    if (candidates.length === 1) return candidates[0];
    if (Number.isInteger(sendButtonProfile.form_index)) {
      const all = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')];
      const indexed = all[sendButtonProfile.form_index] || null;
      if (indexed && candidates.includes(indexed)) return indexed;
    }
    return null;
  }

  function sendButtonCandidates(context) {
    if (!context?.form?.contains(context.composer)) return [];
    if (sendButtonProfile) {
      const manualCandidates = [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')]
        .filter((button) => signatureMatchesButton(sendButtonProfile, button))
        .filter((button) => button instanceof HTMLElement && visible(button) && !insideAssistantEditor(button))
        .filter((button) => !(button instanceof HTMLButtonElement && button.disabled) && button.getAttribute("aria-disabled") !== "true");
      if (manualCandidates.length > 0) return manualCandidates;
    }
    return [...context.form.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((button) => button instanceof HTMLElement && visible(button) && !insideAssistantEditor(button))
      .filter((button) => !(button instanceof HTMLButtonElement && button.disabled) && button.getAttribute("aria-disabled") !== "true")
      .filter((button) => !/stop|cancel|abort|останов|отмен/.test(buttonToken(button)))
      .map((button) => {
        const token = buttonToken(button);
        let score = 0;
        if ((button.getAttribute("data-testid") || "").toLowerCase().includes("send")) score += 1000;
        if (/\bsend\b|отправ/.test(token)) score += 600;
        if ((button.getAttribute("type") || "").toLowerCase() === "submit") score += 300;
        return { button, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  function sendButton(context) {
    if (!context?.form?.contains(context.composer)) return null;
    if (sendButtonProfile) {
      const manual = manualSendButton(context);
      if (manual) return manual;
    }
    const candidates = sendButtonCandidates(context);
    const top = candidates[0];
    if (!top) return null;
    if (top.score >= 600) {
      const tied = candidates.filter((item) => item.score === top.score);
      return tied.length === 1 ? top.button : null;
    }
    const submitOnly = candidates.filter((item) => item.score === 300);
    return submitOnly.length === 1 ? submitOnly[0].button : null;
  }

  function turnSections() {
    return [...document.querySelectorAll('section[data-turn][data-turn-id]')];
  }

  globalThis.BB2CaptureEnvironment = Object.freeze({ turnSections });

  function assistantTurnIds() {
    return turnSections()
      .filter((section) => section.getAttribute("data-turn") === "assistant")
      .map((section) => section.getAttribute("data-turn-id"))
      .filter(Boolean);
  }

  var MANUAL_COPY_ADAPTER_IDS = BB2ManualControls.MANUAL_COPY_ADAPTER_IDS;
  var CURRENT_WRITING_BLOCK_ROOT_SELECTOR = [
    '[data-writing-block="true"][data-testid="writing-block-container"]',
    '[data-writing-block-id][data-testid="writing-block-container"]',
    '[data-oai-writing-block-surface][data-writing-block="true"]'
  ].join(", ");
  var CURRENT_WRITING_BLOCK_BODY_SELECTOR = "[data-writing-block-fullscreen-editor-region]";

  function normalizeCopyButtonProfiles(value) {
    return BB2ManualControls.normalizeCopyButtonProfileCollection(value).profiles;
  }

  function mergeCopyButtonProfiles(value) {
    return BB2ManualControls.mergeCopyButtonProfileCollections(
      { kind: "bb2_manual_copy_profiles_v2", profiles: copyButtonProfiles },
      value
    ).profiles;
  }

  function copyButtonToken(button) {
    return [
      button.getAttribute("data-testid") || "",
      button.getAttribute("aria-label") || "",
      button.getAttribute("title") || "",
      button.getAttribute("name") || "",
      button.textContent || ""
    ].join(" ").toLowerCase();
  }

  function isGenericAssistantCopyButton(button) {
    if (!(button instanceof HTMLButtonElement)) return true;
    const testid = button.getAttribute("data-testid") || "";
    const token = copyButtonToken(button);
    return testid === "copy-turn-action-button" || /копировать\s+ответ|copy\s+response/u.test(token);
  }

  function looksLikeLocalCopyControl(button) {
    if (!(button instanceof HTMLButtonElement) || isGenericAssistantCopyButton(button)) return false;
    const testid = (button.getAttribute("data-testid") || "").toLowerCase();
    const token = copyButtonToken(button);
    return testid.includes("copy") ||
      /(?:^|\s)(?:копировать|copy)(?:\s|$)/u.test(token) ||
      Boolean(button.querySelector('svg use[href*="#ce3544"]'));
  }

  function copyButtonSignature(button, adapterId) {
    const testid = button.getAttribute("data-testid") || "";
    const aria = button.getAttribute("aria-label") || "";
    const decoration = manualModeDecorations.get(button);
    const title = decoration ? (decoration.title || "") : (button.getAttribute("title") || "");
    const name = button.getAttribute("name") || "";
    return {
      kind: "bb2_manual_copy_button_v2",
      profile_id: `copy-profile-${crypto.randomUUID()}`,
      adapter_id: adapterId,
      tag: button.tagName.toLowerCase(),
      testid,
      aria,
      title,
      name,
      type: button.getAttribute("type") || "",
      text_hint: (testid || aria || title || name) ? "" : canonicalText(button.textContent || "").slice(0, 120),
      created_at: new Date().toISOString()
    };
  }
