  function enhanceLastManualBlocks(limit = MANUAL_INITIAL_BLOCK_LIMIT) {
    if (!manualModeEnabled) return;
    const scan = latestManualBlockRoots(limit);
    scan.roots.forEach((root) => {
      manualModeTrackedRoots.add(root);
      enhanceManualBlockRoot(root);
    });
    manualModeTailRoot = scan.roots.at(-1) || null;
    recordContentDiagnostic("MANUAL_MODE_INITIAL_SCAN_COMPLETED", {
      visited_nodes: scan.visited_nodes,
      enhanced: scan.roots.filter((root) => Boolean(localWritingBlockCopyButton(root))).length,
      limit,
      capped: scan.capped,
      builtin_adapter_count: BB2ManualControls.BUILTIN_MANUAL_COPY_ADAPTER_COUNT,
      custom_profile_count: copyButtonProfiles.length
    });
  }


  function enableManualModeEnhancement(reason = "operator") {
    if (manualModeEnabled && manualModeObserver) return;
    manualModeEnabled = true;
    enhanceLastManualBlocks(MANUAL_INITIAL_BLOCK_LIMIT);
    if (manualModeObserver) manualModeObserver.disconnect();
    manualModeObserver = new MutationObserver((mutations) => {
      if (!manualModeEnabled) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          candidateRootsFromAddedNode(node).forEach(queueManualModeRoot);
        }
      }
    });
    const observerRoot = document.querySelector("main") || document.body || document.documentElement;
    manualModeObserver.observe(observerRoot, { childList: true, subtree: true });
    recordContentDiagnostic("MANUAL_MODE_ENABLED", {
      reason,
      initial_limit: MANUAL_INITIAL_BLOCK_LIMIT,
      initial_node_limit: MANUAL_INITIAL_NODE_LIMIT,
      observer_strategy: "added_nodes_only",
      observer_root: observerRoot.tagName.toLowerCase()
    });
  }

  function disableManualModeEnhancement(reason = "operator") {
    const wasActive = manualModeEnabled || Boolean(manualModeObserver) || manualModeDecorations.size > 0;
    manualModeEnabled = false;
    if (manualModeObserver) manualModeObserver.disconnect();
    manualModeObserver = null;
    if (manualModeFlushTimer) clearTimeout(manualModeFlushTimer);
    manualModeFlushTimer = null;
    manualModePendingRoots.clear();
    manualModeTrackedRoots.clear();
    manualModeTailRoot = null;
    for (const button of [...manualModeDecorations.keys()]) restoreManualCopyButton(button, reason);
    if (wasActive) recordContentDiagnostic("MANUAL_MODE_DISABLED", { reason });
  }

  function applyManualMode(enabled, reason = "worker") {
    if (enabled === true) enableManualModeEnhancement(reason);
    else disableManualModeEnhancement(reason);
  }

  function candidateAfterAssistantBaseline(baselineIds, watchId) {
    const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds || []);
    const assistants = turnSections().filter((section) => {
      const id = section.getAttribute("data-turn-id") || "";
      return section.getAttribute("data-turn") === "assistant" && Boolean(id) && !baseline.has(id);
    });
    const assistant = assistants[assistants.length - 1] || null;
    if (!assistant) return { waiting: true };

    const assistantTurnId = assistant.getAttribute("data-turn-id") || "";
    const copy = BB2ProvenWritingCapture.detectCopyReadiness(assistant);
    const writingBlockId = BB2ProvenWritingCapture.writingBlockStructuralId(assistant);
    const promptText = copy.writing_block
      ? BB2ProvenWritingCapture.sectionWritingBlockText(assistant)
      : "";
    const structuralSignature = [
      watchId || "",
      assistantTurnId,
      writingBlockId || "",
      copy.writing_block === true ? "writing-block" : "no-writing-block",
      copy.ready === true ? "copy-ready" : "copy-pending",
      copy.mode || ""
    ].join("||");

    return {
      assistant_turn_id: assistantTurnId,
      prompt_text: promptText,
      copy_ready: copy.ready,
      copy_mode: copy.mode,
      writing_block: copy.writing_block,
      writing_block_id: writingBlockId,
      structural_signature: structuralSignature
    };
  }

  async function clickComposerUntilEmpty({ area, runId, details = {} }) {
    let clickAttempts = 0;
    while (current()) {
      if (stoppedRunIds.has(runId)) {
        throw Object.assign(new Error("Run жёстко остановлен во время отправки composer."), { code: "HARD_STOP_DURING_COMPOSER_SEND" });
      }

      const context = primaryComposerContext();
      if (!context) {
        recordContentDiagnostic(`${area}_COMPOSER_WAITING`, { ...details, run_id: runId, reason: "composer_missing", click_attempts: clickAttempts });
        await sleep(COMPOSER_SEND_RETRY_MS);
        continue;
      }

      const currentText = canonicalText(composerText(context.composer));
      if (!currentText) {
        recordContentDiagnostic(`${area}_COMPOSER_EMPTY`, { ...details, run_id: runId, click_attempts: clickAttempts });
        return { composer_empty: true, click_attempts: clickAttempts };
      }

      const target = await waitForStableSendTarget(10000, null);
      if (!target) {
        recordContentDiagnostic(`${area}_SEND_BUTTON_WAITING`, { ...details, run_id: runId, click_attempts: clickAttempts });
        await sleep(COMPOSER_SEND_RETRY_MS);
        continue;
      }

      if (stoppedRunIds.has(runId)) {
        throw Object.assign(new Error("Run жёстко остановлен до очередного Send."), { code: "HARD_STOP_BEFORE_COMPOSER_SEND" });
      }

      const clickResult = BB2ComposerSend.clickSynchronously({
        target,
        expectedText: null,
        deps: composerSendDeps(),
        beforeClick(snapshot) {
          recordContentDiagnostic(`${area}_PRE_SEND_SNAPSHOT`, { ...details, run_id: runId, click_attempt: clickAttempts + 1, ...snapshot });
        }
      });
      clickAttempts += 1;
      recordContentDiagnostic(`${area}_SEND_CALLED`, {
        ...details,
        run_id: runId,
        click_attempt: clickAttempts,
        click_method: clickResult.method,
        click_event_observed: clickResult.click_event_observed,
        ...clickResult.trace
      });
      await sleep(COMPOSER_SEND_RETRY_MS);
    }
    throw Object.assign(new Error("Content runtime superseded during composer send."), { code: "CONTENT_RUNTIME_SUPERSEDED" });
  }

  async function sendStartMessage(messageText, runId) {
    showStatus("Business Bridge 2: отправляю команду запуска.", "operator_work", `start:${runId}`);
    if (stoppedRunIds.has(runId)) throw Object.assign(new Error("Run жёстко остановлен до отправки start."), { code: "HARD_STOP_BEFORE_START" });

    const initialContext = primaryComposerContext();
    if (!initialContext) throw Object.assign(new Error("Не найдено нижнее поле ChatGPT."), { code: "COMPOSER_NOT_FOUND" });
    const existing = canonicalText(composerText(initialContext.composer));
    if (existing && normalizedDeliveryText(existing) !== normalizedDeliveryText(messageText)) {
      throw Object.assign(new Error("Нижнее поле содержит неотправленный текст до подготовки команды запуска."), { code: "COMPOSER_CONTAINS_OTHER_TEXT" });
    }

    const assistantBaselineIds = assistantTurnIds();
    if (!existing) setComposerText(initialContext.composer, messageText);
    recordContentDiagnostic(existing ? "START_TEXT_REUSED" : "START_TEXT_STAGED", { run_id: runId });

    await stabilizeComposerForSend(messageText, "START", { run_id: runId, reused_existing_text: Boolean(existing) });
    const preCommitTarget = await waitForStableSendTarget(10000, messageText);
    if (!preCommitTarget) throw Object.assign(new Error("Send-кнопка не готова до start commit."), { code: "START_SEND_TARGET_NOT_READY_BEFORE_COMMIT" });

    const commit = await sendRuntime("BB2_START_COMMIT_REQUEST", { run_id: runId, previous_user_turn_id: null });
    if (!commit.ok || !commit.committed) throw Object.assign(new Error(commit.error || "Start commit rejected."), { code: commit.code || "START_COMMIT_REJECTED" });

    const sent = await clickComposerUntilEmpty({ area: "START", runId });
    showStatus("Business Bridge 2: команда отправлена. Жду writing block.", "cli_work", `start-sent:${runId}`);
    return {
      committed: true,
      sent: true,
      composer_empty: true,
      click_attempts: sent.click_attempts,
      assistant_baseline_ids: assistantBaselineIds,
      identity: identity()
    };
  }

  function stopPromptWatch(reason = "stopped") {
    const previous = activePromptWatch;
    if (observer) observer.disconnect();
    observer = null;
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = null;
    activePromptWatch = null;
    promptFirstSeen = null;
    if (previous) recordContentDiagnostic("PROMPT_WATCH_STOPPED", { run_id: previous.run_id, reason });
  }

  function schedulePromptTick(delay = 0) {
    if (!activePromptWatch || observerTimer) return;
    observerTimer = setTimeout(() => {
      observerTimer = null;
      promptTick().catch((error) => showStatus(`Ошибка поиска writing block: ${error.message}`, "error"));
    }, delay);
  }

  async function promptTick() {
    if (!current() || !activePromptWatch || promptTickInFlight) return;
    promptTickInFlight = true;
    try {
      const candidate = candidateAfterAssistantBaseline(activePromptWatch.assistant_baseline_ids, activePromptWatch.watch_id);
      if (candidate.waiting) {
        promptFirstSeen = null;
        schedulePromptTick(750);
        return;
      }
      if (!candidate.writing_block || !candidate.prompt_text || !candidate.copy_ready) {
        promptFirstSeen = null;
        schedulePromptTick(750);
        return;
      }
      if (!promptFirstSeen || promptFirstSeen.signature !== candidate.structural_signature) {
        promptFirstSeen = { signature: candidate.structural_signature, at: Date.now() };
        recordContentDiagnostic("PROMPT_CANDIDATE_STABILITY_STARTED", {
          run_id: activePromptWatch.run_id,
          assistant_turn_id: candidate.assistant_turn_id,
          structural_signature: candidate.structural_signature
        });
        schedulePromptTick(PROMPT_STABILITY_MS);
        return;
      }
      if (Date.now() - promptFirstSeen.at < PROMPT_STABILITY_MS) {
        schedulePromptTick(PROMPT_STABILITY_MS - (Date.now() - promptFirstSeen.at));
        return;
      }
      const section = turnSections().find((item) => item.getAttribute("data-turn-id") === candidate.assistant_turn_id) || null;
      const localPayload = BB2ProvenWritingCapture.confirmLocalWritingBlockCopyAndExtract(section);
      if (!localPayload.ok) {
        recordContentDiagnostic("PROMPT_LOCAL_EXTRACTION_PENDING", {
          run_id: activePromptWatch.run_id,
          assistant_turn_id: candidate.assistant_turn_id,
          code: localPayload.code || "LOCAL_EXTRACTION_PENDING"
        });
        promptFirstSeen = null;
        schedulePromptTick(750);
        return;
      }
      const response = await sendRuntime("BB2_PROMPT_READY", {
        run_id: activePromptWatch.run_id,
        identity: identity(),
        watch_id: activePromptWatch.watch_id,
        assistant_turn_id: candidate.assistant_turn_id,
        prompt_text: localPayload.text,
        prompt_fingerprint: BB2Protocol.fnv1a32(localPayload.text)
      });
      if (response.ok && response.accepted) {
        showStatus("Business Bridge 2: writing block передан серверу.", "operator_success");
        recordContentDiagnostic("PROMPT_ACCEPTED", { run_id: activePromptWatch.run_id, assistant_turn_id: candidate.assistant_turn_id, prompt_fingerprint: BB2Protocol.fnv1a32(localPayload.text) });
        stopPromptWatch("prompt_accepted");
      } else if (response.paused) {
        showStatus(`Business Bridge 2: ${response.error || "автоматизация на паузе"}`, response.error ? "error" : "operator_work");
        recordContentDiagnostic("PROMPT_REJECTED_PAUSED", { run_id: activePromptWatch.run_id, error: response.error || null });
        stopPromptWatch("worker_paused");
      } else {
        schedulePromptTick(1000);
      }
    } finally {
      promptTickInFlight = false;
    }
  }

  function beginPromptWatch(message) {
    stopPromptWatch("replaced");
    activePromptWatch = {
      run_id: message.run_id,
      conversation_id: message.conversation_id,
      watch_id: message.watch_id,
      assistant_baseline_ids: new Set(Array.isArray(message.assistant_baseline_ids) ? message.assistant_baseline_ids : [])
    };
    observer = new MutationObserver(() => {
      if (!observerTimer) schedulePromptTick(PROMPT_DEBOUNCE_MS);
    });
    recordContentDiagnostic("PROMPT_WATCH_STARTED", {
      run_id: message.run_id,
      conversation_id: message.conversation_id,
      watch_id: message.watch_id,
      assistant_baseline_count: activePromptWatch.assistant_baseline_ids.size
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "class", "data-testid", "aria-label", "title"]
    });
    schedulePromptTick(0);
  }

  function fileInput(context) {
    return [...context.form.querySelectorAll('input[type="file"]')]
      .find((input) => input instanceof HTMLInputElement && !input.disabled && !insideAssistantEditor(input)) || null;
  }

  function dataUrlToFile(record) {
    const dataUrl = String(record?.data_url || "");
    const match = dataUrl.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!match) throw new Error("Некорректный data URL файла контекста.");
    const mime = match[1] || record.mime_type || "application/octet-stream";
    const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return new File([bytes], record.file_name, { type: mime });
  }

  async function prepareAttachmentFiles(context, files) {
    if (!files.length) return false;
    const input = fileInput(context);
    if (!input) throw new Error("ChatGPT file input не найден.");
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
    if (!descriptor?.set) throw new Error("Browser file setter unavailable.");
    descriptor.set.call(input, transfer.files);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(900);
    return true;
  }
