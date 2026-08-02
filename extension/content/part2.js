  function signatureMatchesCopyButton(profile, binding, button) {
    const normalized = BB2ManualControls.normalizeCopyButtonProfile(profile);
    if (!normalized || !(button instanceof HTMLButtonElement) || normalized.adapter_id !== binding?.adapter_id) return false;
    if (normalized.tag && button.tagName.toLowerCase() !== normalized.tag) return false;
    for (const [key, attribute] of [["testid", "data-testid"], ["aria", "aria-label"], ["title", "title"], ["name", "name"], ["type", "type"]]) {
      if (normalized[key] && (button.getAttribute(attribute) || "") !== normalized[key]) return false;
    }
    if (normalized.text_hint && canonicalText(button.textContent || "").slice(0, 120) !== normalized.text_hint) return false;
    return true;
  }

  function legacyManualBindingFromRoot(root) {
    if (!(root instanceof HTMLPreElement)) return null;
    const viewers = [...root.querySelectorAll("#code-block-viewer")];
    if (viewers.length !== 1) return null;
    const section = root.closest('section[data-turn="assistant"][data-turn-id]');
    if (!(section instanceof Element)) return null;
    return {
      adapter_id: MANUAL_COPY_ADAPTER_IDS.LEGACY_CODE_BLOCK,
      root,
      body: viewers[0],
      section
    };
  }

  function currentManualBindingFromRoot(root) {
    if (!(root instanceof Element) || !root.matches(CURRENT_WRITING_BLOCK_ROOT_SELECTOR)) return null;
    const bodies = [...root.querySelectorAll(CURRENT_WRITING_BLOCK_BODY_SELECTOR)];
    if (bodies.length !== 1) return null;
    const section = root.closest('section[data-turn="assistant"][data-turn-id]');
    if (!(section instanceof Element)) return null;
    return {
      adapter_id: MANUAL_COPY_ADAPTER_IDS.CURRENT_WRITING_BLOCK,
      root,
      body: bodies[0],
      section
    };
  }

  function manualBindingFromRoot(root) {
    return currentManualBindingFromRoot(root) || legacyManualBindingFromRoot(root);
  }

  function manualBindingFromCopyButton(button) {
    if (!(button instanceof HTMLButtonElement) || isGenericAssistantCopyButton(button)) return null;
    const currentRoot = button.closest(CURRENT_WRITING_BLOCK_ROOT_SELECTOR);
    const currentBinding = currentManualBindingFromRoot(currentRoot);
    if (currentBinding?.root.contains(button)) return currentBinding;
    const legacyRoot = button.closest("pre");
    const legacyBinding = legacyManualBindingFromRoot(legacyRoot);
    return legacyBinding?.root.contains(button) ? legacyBinding : null;
  }

  function isLocalWritingBlockCopyButton(button, binding = null) {
    const resolved = binding || manualBindingFromCopyButton(button);
    if (!(button instanceof HTMLButtonElement) || !resolved || !resolved.root.contains(button) || isGenericAssistantCopyButton(button)) return false;
    const customMatch = copyButtonProfiles.some((profile) => signatureMatchesCopyButton(profile, resolved, button));
    return customMatch || looksLikeLocalCopyControl(button);
  }

  function localWritingBlockRootFromCopyButton(button) {
    const binding = manualBindingFromCopyButton(button);
    return binding && isLocalWritingBlockCopyButton(button, binding) ? binding.root : null;
  }

  function localWritingBlockCopyButton(root) {
    const binding = manualBindingFromRoot(root);
    if (!binding) return null;
    const candidates = [...binding.root.querySelectorAll("button")]
      .filter((button) => isLocalWritingBlockCopyButton(button, binding));
    return candidates.length === 1 ? candidates[0] : null;
  }

  function manualPromptText(binding) {
    if (!(binding?.body instanceof Element)) return "";
    return String(binding.body.innerText || binding.body.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/^\s+|\s+$/g, "");
  }

  function manualWritingBlockId(binding) {
    const assistantTurnId = binding.section.getAttribute("data-turn-id") || "";
    if (binding.adapter_id === MANUAL_COPY_ADAPTER_IDS.CURRENT_WRITING_BLOCK) {
      const explicit = binding.root.getAttribute("data-writing-block-id") || binding.root.id || "";
      if (explicit) return explicit;
      const roots = [...binding.section.querySelectorAll(CURRENT_WRITING_BLOCK_ROOT_SELECTOR)]
        .filter((root) => Boolean(currentManualBindingFromRoot(root)));
      return `${assistantTurnId}:writing-block:${Math.max(0, roots.indexOf(binding.root)) + 1}`;
    }
    const viewers = [...binding.section.querySelectorAll("#code-block-viewer")];
    return `${assistantTurnId}:code-block:${Math.max(0, viewers.indexOf(binding.body)) + 1}`;
  }

  function manualPromptPayloadForCopyButton(button) {
    const binding = manualBindingFromCopyButton(button);
    if (!binding || !isLocalWritingBlockCopyButton(button, binding)) return null;
    const promptText = manualPromptText(binding);
    const assistantTurnId = binding.section.getAttribute("data-turn-id") || "";
    if (!promptText || !assistantTurnId) return null;
    return {
      prompt_text: promptText,
      assistant_turn_id: assistantTurnId,
      writing_block_id: manualWritingBlockId(binding),
      adapter_id: binding.adapter_id
    };
  }

  function styleSnapshot(element, property) {
    return {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    };
  }

  function restoreStyleSnapshot(element, property, snapshot) {
    if (!snapshot?.value) element.style.removeProperty(property);
    else element.style.setProperty(property, snapshot.value, snapshot.priority || "");
  }

  async function submitManualCliBlock(payload, copyButton) {
    if (!manualModeEnabled || !payload) return;
    const stateResponse = await sendRuntime("BB2_GET_MANUAL_BUTTON_STATE", { identity: identity() });
    const state = stateResponse.ok && stateResponse.state
      ? stateResponse.state
      : { enabled: false, code: "STATE_UNAVAILABLE", title: stateResponse.error || "Bridge state unavailable." };
    recordContentDiagnostic("MANUAL_NATIVE_COPY_CLICKED", {
      assistant_turn_id: payload.assistant_turn_id,
      writing_block_id: payload.writing_block_id,
      adapter_id: payload.adapter_id || null,
      manual_state_code: state.code || null,
      manual_state_enabled: state.enabled === true
    });
    if (state.enabled !== true) {
      const busy = state.code === "RUN_BUSY" || state.code === "PAUSE_PENDING";
      showStatus(`Business Bridge 2: ${state.title || "ручная отправка сейчас недоступна"}`, busy ? "operator_work" : "error");
      return;
    }
    const response = await sendRuntime("BB2_MANUAL_SUBMIT_WRITING_BLOCK", {
      identity: identity(),
      manual_request_id: crypto.randomUUID(),
      assistant_turn_id: payload.assistant_turn_id,
      writing_block_id: payload.writing_block_id,
      prompt_text: payload.prompt_text,
      prompt_fingerprint: BB2Protocol.fnv1a32(payload.prompt_text)
    });
    if (response.ok && response.data?.accepted) {
      showStatus("Business Bridge 2: блок скопирован и передан в CLI.", "operator_success");
      recordContentDiagnostic("MANUAL_NATIVE_COPY_SUBMITTED", {
        assistant_turn_id: payload.assistant_turn_id,
        writing_block_id: payload.writing_block_id,
        adapter_id: payload.adapter_id || null,
        run_id: response.data.run_id || null,
        duplicate: response.data.duplicate === true
      });
    } else {
      const busy = response.data?.code === "RUN_BUSY";
      showStatus(`Business Bridge 2: ${busy ? "Bridge уже выполняет или доставляет задачу." : (response.error || response.data?.title || "ручная отправка не выполнена")}`, busy ? "operator_work" : "error");
      recordContentDiagnostic("MANUAL_NATIVE_COPY_SUBMIT_FAILED", {
        assistant_turn_id: payload.assistant_turn_id,
        writing_block_id: payload.writing_block_id,
        adapter_id: payload.adapter_id || null,
        error: response.error || "manual submission failed"
      });
    }
    if (copyButton instanceof HTMLElement && copyButton.isConnected) {
      copyButton.style.setProperty("filter", "saturate(1.15)", "");
      setTimeout(() => {
        if (copyButton.isConnected && manualModeDecorations.has(copyButton)) {
          const decoration = manualModeDecorations.get(copyButton);
          restoreStyleSnapshot(copyButton, "filter", decoration.styles.filter);
        }
      }, 180);
    }
  }

  function restoreManualCopyButton(button, reason = "manual_mode_off") {
    const decoration = manualModeDecorations.get(button);
    if (!decoration) return;
    button.removeEventListener("click", decoration.handler, true);
    for (const [property, snapshot] of Object.entries(decoration.styles)) {
      restoreStyleSnapshot(button, property, snapshot);
    }
    if (decoration.title === null) button.removeAttribute("title");
    else button.setAttribute("title", decoration.title);
    manualModeDecorations.delete(button);
    recordContentDiagnostic("MANUAL_NATIVE_COPY_RESTORED", {
      reason,
      connected: button.isConnected === true
    });
  }

  function replaceCopyButtonProfiles(value, reason = "profiles_changed") {
    for (const button of [...manualModeDecorations.keys()]) restoreManualCopyButton(button, reason);
    copyButtonProfiles = normalizeCopyButtonProfiles(value);
    if (manualModeEnabled) {
      for (const root of [...manualModeTrackedRoots]) {
        if (root.isConnected) enhanceManualBlockRoot(root);
      }
    }
  }

  function enhanceManualCopyButton(button) {
    const binding = manualBindingFromCopyButton(button);
    if (!manualModeEnabled || !binding || !isLocalWritingBlockCopyButton(button, binding)) return false;
    if (manualModeDecorations.has(button)) return true;
    const styles = Object.fromEntries([
      "color",
      "background-color",
      "box-shadow",
      "filter"
    ].map((property) => [property, styleSnapshot(button, property)]));
    const decoration = {
      title: button.hasAttribute("title") ? button.getAttribute("title") : null,
      styles,
      in_flight: false,
      handler: null
    };
    decoration.handler = () => {
      if (!manualModeEnabled) return;
      if (decoration.in_flight) {
        showStatus("Business Bridge 2: Bridge уже выполняет или доставляет задачу.", "operator_work");
        return;
      }
      const payload = manualPromptPayloadForCopyButton(button);
      if (!payload) {
        showStatus("Business Bridge 2: локальный writing block ещё не готов.", "error");
        return;
      }
      decoration.in_flight = true;
      // Native Copy remains untouched.
      submitManualCliBlock(payload, button)
        .catch((error) => showStatus(`Business Bridge 2: ${error.message}`, "error"))
        .finally(() => { decoration.in_flight = false; });
    };
    button.addEventListener("click", decoration.handler, true);
    button.style.setProperty("color", "#60a5fa", "important");
    button.style.setProperty("background-color", "rgba(37, 99, 235, 0.22)", "important");
    button.style.setProperty("box-shadow", "inset 0 0 0 1px rgba(96, 165, 250, 0.75)", "important");
    button.setAttribute("title", "Копировать и отправить этот writing block в CLI");
    manualModeDecorations.set(button, decoration);
    recordContentDiagnostic("MANUAL_NATIVE_COPY_ENHANCED", {
      assistant_turn_id: binding.section.getAttribute("data-turn-id") || null,
      writing_block_id: manualWritingBlockId(binding),
      adapter_id: binding.adapter_id
    });
    return true;
  }

  function enhanceManualBlockRoot(root) {
    const binding = manualBindingFromRoot(root);
    if (!manualModeEnabled || !binding) return false;
    const copyButton = localWritingBlockCopyButton(binding.root);
    return copyButton ? enhanceManualCopyButton(copyButton) : false;
  }

  function candidateRootsFromAddedNode(node) {
    if (!(node instanceof Element)) return [];
    const roots = new Set();
    const addRoot = (candidate) => {
      const binding = manualBindingFromRoot(candidate);
      if (binding) roots.add(binding.root);
    };
    const addFromElement = (candidate) => {
      if (!(candidate instanceof Element)) return;
      if (candidate.matches(CURRENT_WRITING_BLOCK_ROOT_SELECTOR)) addRoot(candidate);
      if (candidate.matches(CURRENT_WRITING_BLOCK_BODY_SELECTOR)) addRoot(candidate.closest(CURRENT_WRITING_BLOCK_ROOT_SELECTOR));
      if (candidate.id === "code-block-viewer") addRoot(candidate.closest("pre"));
      if (candidate instanceof HTMLButtonElement) addRoot(manualBindingFromCopyButton(candidate)?.root);
    };
    addFromElement(node);
    for (const currentRoot of node.querySelectorAll(CURRENT_WRITING_BLOCK_ROOT_SELECTOR)) addRoot(currentRoot);
    for (const currentBody of node.querySelectorAll(CURRENT_WRITING_BLOCK_BODY_SELECTOR)) addRoot(currentBody.closest(CURRENT_WRITING_BLOCK_ROOT_SELECTOR));
    for (const viewer of node.querySelectorAll("#code-block-viewer")) addRoot(viewer.closest("pre"));
    for (const button of node.querySelectorAll("button")) addRoot(manualBindingFromCopyButton(button)?.root);
    return [...roots];
  }

  function rootDocumentOrder(left, right) {
    if (left === right) return 0;
    const relation = left.compareDocumentPosition(right);
    return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  function processNewManualRoot(root) {
    const binding = manualBindingFromRoot(root);
    if (!manualModeEnabled || !binding || !binding.root.isConnected) return false;
    root = binding.root;
    if (manualModeTrackedRoots.has(root)) return enhanceManualBlockRoot(root);
    if (!manualModeTailRoot || !manualModeTailRoot.isConnected) {
      manualModeTailRoot = root;
      manualModeTrackedRoots.add(root);
      return enhanceManualBlockRoot(root);
    }
    if (root === manualModeTailRoot) {
      manualModeTrackedRoots.add(root);
      return enhanceManualBlockRoot(root);
    }
    const relation = manualModeTailRoot.compareDocumentPosition(root);
    if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) {
      recordContentDiagnostic("MANUAL_MODE_OLD_DOM_INSERT_IGNORED", {
        assistant_turn_id: binding.section.getAttribute("data-turn-id") || null,
        adapter_id: binding.adapter_id
      });
      return false;
    }
    manualModeTailRoot = root;
    manualModeTrackedRoots.add(root);
    return enhanceManualBlockRoot(root);
  }

  function flushManualModeRoots() {
    manualModeFlushTimer = null;
    if (!manualModeEnabled) {
      manualModePendingRoots.clear();
      return;
    }
    for (const button of [...manualModeDecorations.keys()]) {
      if (!button.isConnected) manualModeDecorations.delete(button);
    }
    for (const root of [...manualModeTrackedRoots]) {
      if (!root.isConnected) manualModeTrackedRoots.delete(root);
    }
    const roots = [...manualModePendingRoots].sort(rootDocumentOrder);
    manualModePendingRoots.clear();
    roots.forEach(processNewManualRoot);
  }

  function queueManualModeRoot(root) {
    const binding = manualBindingFromRoot(root);
    if (!manualModeEnabled || !binding) return;
    manualModePendingRoots.add(binding.root);
    if (manualModeFlushTimer) return;
    manualModeFlushTimer = setTimeout(flushManualModeRoots, 60);
  }

  function previousElementInDocumentOrder(node, boundary) {
    if (!(node instanceof Element) || !(boundary instanceof Element)) return null;
    if (node.previousElementSibling) {
      let candidate = node.previousElementSibling;
      while (candidate.lastElementChild) candidate = candidate.lastElementChild;
      return candidate;
    }
    const parent = node.parentElement;
    return parent && parent !== boundary ? parent : null;
  }

  function latestManualBlockRoots(limit = MANUAL_INITIAL_BLOCK_LIMIT, nodeLimit = MANUAL_INITIAL_NODE_LIMIT) {
    const boundary = document.querySelector("main") || document.body || document.documentElement;
    if (!(boundary instanceof Element)) return { roots: [], visited_nodes: 0, capped: false };
    const roots = [];
    const seen = new Set();
    let node = boundary.lastElementChild;
    while (node?.lastElementChild) node = node.lastElementChild;
    let visited = 0;
    while (node && roots.length < limit && visited < nodeLimit) {
      visited += 1;
      let binding = null;
      if (node.matches(CURRENT_WRITING_BLOCK_ROOT_SELECTOR)) binding = currentManualBindingFromRoot(node);
      else if (node.matches(CURRENT_WRITING_BLOCK_BODY_SELECTOR)) binding = currentManualBindingFromRoot(node.closest(CURRENT_WRITING_BLOCK_ROOT_SELECTOR));
      else if (node.id === "code-block-viewer") binding = legacyManualBindingFromRoot(node.closest("pre"));
      if (binding && !seen.has(binding.root)) {
        seen.add(binding.root);
        roots.push(binding.root);
      }
      node = previousElementInDocumentOrder(node, boundary);
    }
    roots.reverse();
    return { roots, visited_nodes: visited, capped: Boolean(node && roots.length < limit) };
  }
