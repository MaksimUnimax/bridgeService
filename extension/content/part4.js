  async function deliverReport(message) {
    showStatus("Business Bridge 2: отправляю terminal report.", "operator_work", `delivery:${message.run_id}`);
    if (stoppedRunIds.has(message.run_id)) throw Object.assign(new Error("Run жёстко остановлен до доставки отчёта."), { code: "HARD_STOP_BEFORE_DELIVERY" });

    const outgoingText = String(message.outgoing_text || message.report_text || "");
    const assistantBaselineIds = assistantTurnIds();
    const context = primaryComposerContext();
    if (!context) throw new Error("Не найдено нижнее поле ChatGPT для отчёта.");
    const existing = canonicalText(composerText(context.composer));
    const deliveryId = String(message.delivery_id || "");
    const existingStage = context.composer.getAttribute(STAGE_DELIVERY_ATTR) || "";
    const ownsStage = context.composer.getAttribute(STAGE_ATTR) === "1" && existingStage === deliveryId;
    if (existing && !ownsStage && normalizedDeliveryText(existing) !== normalizedDeliveryText(outgoingText)) {
      throw new Error("Нижнее поле содержит неотправленный текст до подготовки отчёта.");
    }

    let contextAttachmentUploaded = false;
    if (!ownsStage) {
      const requiredFiles = [];
      if (message.report_mode === "attachment") {
        requiredFiles.push(new File([message.report_text], message.attachment_name, { type: "text/markdown" }));
      }
      if (message.context_attachment) {
        try {
          requiredFiles.push(dataUrlToFile(message.context_attachment));
          contextAttachmentUploaded = true;
        } catch (error) {
          contextAttachmentUploaded = false;
          recordContentDiagnostic("CONTEXT_ATTACHMENT_PREPARE_FAILED", { run_id: message.run_id, delivery_id: deliveryId, error: error.message });
        }
      }
      if (requiredFiles.length) {
        try {
          await prepareAttachmentFiles(context, requiredFiles);
          recordContentDiagnostic("DELIVERY_ATTACHMENTS_STAGED", {
            run_id: message.run_id,
            delivery_id: deliveryId,
            file_count: requiredFiles.length,
            report_attachment: message.report_mode === "attachment",
            context_attachment: contextAttachmentUploaded
          });
        } catch (error) {
          if (message.report_mode === "attachment") throw error;
          contextAttachmentUploaded = false;
          recordContentDiagnostic("OPTIONAL_CONTEXT_ATTACHMENT_UPLOAD_FAILED", { run_id: message.run_id, delivery_id: deliveryId, error: error.message });
        }
      }
    }

    if (!existing || !ownsStage) setComposerText(context.composer, outgoingText);
    recordContentDiagnostic(existing && ownsStage ? "DELIVERY_TEXT_REUSED" : "DELIVERY_TEXT_STAGED", { run_id: message.run_id, delivery_id: deliveryId });
    context.composer.setAttribute(STAGE_ATTR, "1");
    context.composer.setAttribute(STAGE_DELIVERY_ATTR, deliveryId);

    await stabilizeComposerForSend(outgoingText, "DELIVERY", { run_id: message.run_id, delivery_id: deliveryId, reused_existing_text: Boolean(existing && ownsStage) });
    const preCommitTarget = await waitForStableSendTarget(10000, outgoingText);
    if (!preCommitTarget) throw Object.assign(new Error("Send-кнопка не готова до delivery commit."), { code: "DELIVERY_SEND_TARGET_NOT_READY_BEFORE_COMMIT" });

    const commit = await sendRuntime("BB2_DELIVERY_COMMIT_REQUEST", { run_id: message.run_id, delivery_id: deliveryId });
    if (!commit.ok || !commit.committed) throw Object.assign(new Error(commit.error || "Server delivery commit rejected."), { code: commit.code || "DELIVERY_COMMIT_REJECTED" });

    const sent = await clickComposerUntilEmpty({ area: "DELIVERY", runId: message.run_id, details: { delivery_id: deliveryId } });
    const currentContext = primaryComposerContext();
    if (currentContext) {
      currentContext.composer.removeAttribute(STAGE_ATTR);
      currentContext.composer.removeAttribute(STAGE_DELIVERY_ATTR);
    }
    showStatus("Business Bridge 2: отчёт отправлен. Жду следующий writing block.", "operator_success", `delivery-sent:${message.run_id}:${deliveryId}`);
    return {
      committed: true,
      sent: true,
      composer_empty: true,
      click_attempts: sent.click_attempts,
      assistant_baseline_ids: assistantBaselineIds,
      context_attachment_uploaded: contextAttachmentUploaded
    };
  }

  function restorePicker() {
    if (pickerState) {
      try { setComposerText(pickerState.context.composer, pickerState.original_text); } catch (_) {}
      pickerState = null;
    }
    copyPickerActive = false;
  }

  function startSendButtonPicker() {
    const context = primaryComposerContext();
    if (!context) throw new Error("Не найдено нижнее поле ChatGPT.");
    restorePicker();
    pickerState = { context, original_text: composerText(context.composer) };
    setComposerText(context.composer, "BRIDGE_BUTTON_TEST — это тест, сообщение не будет отправлено.");
    showStatus("Business Bridge 2: нажми нужную Send-кнопку в нижней форме. Клик будет перехвачен, тест не отправится.", "operator_work");
  }

  function startCopyButtonPicker() {
    restorePicker();
    copyPickerActive = true;
    showStatus("Business Bridge 2: нажми локальную Copy-кнопку внутри writing block. Клик будет перехвачен только для выбора.", "operator_work");
  }

  document.addEventListener("pointerdown", (event) => {
    if (!pickerState && !copyPickerActive) return;
    if (event.target instanceof Element && event.target.closest(`#${BB2Toast.ROOT_ID}`)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressPickerClick = true;
    const button = event.target instanceof Element
      ? event.target.closest('button, [role="button"], input[type="submit"]')
      : null;

    if (copyPickerActive) {
      if (!(button instanceof HTMLButtonElement)) {
        showStatus("Business Bridge 2: выбери именно локальную Copy-кнопку writing block.", "operator_work");
        return;
      }
      const binding = manualBindingFromCopyButton(button);
      if (!binding || isGenericAssistantCopyButton(button)) {
        showStatus("Business Bridge 2: общая «Копировать ответ» не подходит. Нажми Copy внутри локального writing block.", "operator_work");
        return;
      }
      if (!looksLikeLocalCopyControl(button)) {
        showStatus("Business Bridge 2: выбранный контрол не имеет признаков локальной Copy-кнопки.", "operator_work");
        return;
      }
      if (!manualPromptText(binding)) {
        showStatus("Business Bridge 2: тело выбранного writing block не найдено или пусто.", "operator_work");
        return;
      }
      const profile = copyButtonSignature(button, binding.adapter_id);
      sendRuntime("BB2_SAVE_COPY_BUTTON_PROFILE", { profile }).then((response) => {
        if (!response.ok) throw new Error(response.error || "Не удалось сохранить Copy-кнопку.");
        restorePicker();
        replaceCopyButtonProfiles(response.profiles || { kind: "bb2_manual_copy_profiles_v2", profiles: mergeCopyButtonProfiles(profile) }, "picker_saved");
        showStatus(`Business Bridge 2: Copy-кнопка добавлена; прежние варианты сохранены (${copyButtonProfiles.length} пользовательских).`, "operator_success");
      }).catch((error) => {
        restorePicker();
        showStatus(`Business Bridge 2: ${error.message}`, "error");
      });
      return;
    }

    if (!(button instanceof HTMLElement) || button.closest("form") !== pickerState.context.form) {
      showStatus("Выбери кнопку только в нижней форме ChatGPT.", "operator_work");
      return;
    }
    const profile = manualButtonSignature(button);
    profile.form_index = [...pickerState.context.form.querySelectorAll('button, [role="button"], input[type="submit"]')].indexOf(button);
    sendRuntime("BB2_SAVE_SEND_BUTTON_PROFILE", { profile }).then((response) => {
      if (!response.ok) throw new Error(response.error || "Не удалось сохранить кнопку.");
      sendButtonProfile = profile;
      restorePicker();
      showStatus("Business Bridge 2: Send-кнопка сохранена.", "operator_success");
    }).catch((error) => {
      restorePicker();
      showStatus(`Business Bridge 2: ${error.message}`, "error");
    });
  }, true);

  document.addEventListener("click", (event) => {
    if (!suppressPickerClick) return;
    suppressPickerClick = false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("keydown", (event) => {
    if ((!pickerState && !copyPickerActive) || event.key !== "Escape") return;
    event.preventDefault();
    restorePicker();
    showStatus("Business Bridge 2: выбор кнопки отменён.", "operator_work");
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!current()) return false;

    if (message?.type === "BB2_PING") {
      sendResponse({ ok: true, version: VERSION, content_script_version: VERSION, identity: identity() });
      return false;
    }

    if (message?.type === "BB2_GET_IDENTITY") {
      sendResponse({ ok: true, identity: identity() });
      return false;
    }

    if (message?.type === "BB2_GET_PROMPT_BASELINE") {
      sendResponse({ ok: true, assistant_baseline_ids: assistantTurnIds() });
      return false;
    }

    if (message?.type === "BB2_SEND_START") {
      sendStartMessage(message.message_text || BB2Protocol.START_MESSAGE, message.run_id)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code || "CONTENT_ADAPTER_ERROR" }));
      return true;
    }


    if (message?.type === "BB2_BEGIN_PROMPT_WATCH") {
      const here = identity();
      if (!here.conversation_id || here.conversation_id !== message.conversation_id) {
        sendResponse({ ok: false, error: "Conversation mismatch." });
        return false;
      }
      beginPromptWatch(message);
      showStatus("Business Bridge 2: жду следующий writing block.", "operator_work");
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BB2_TERMINATE_RUN") {
      if (message.run_id) stoppedRunIds.add(String(message.run_id));
      stopPromptWatch("hard_stop");
      recordContentDiagnostic("RUN_HARD_STOP_APPLIED", { run_id: message.run_id || null });
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BB2_STOP_PROMPT_WATCH") {
      stopPromptWatch("worker_request");
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BB2_DELIVER_REPORT") {
      deliverReport(message)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code || "CONTENT_ADAPTER_ERROR" }));
      return true;
    }


    if (message?.type === "BB2_START_COPY_BUTTON_PICKER") {
      try {
        startCopyButtonPicker();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, code: error.code || "CONTENT_ADAPTER_ERROR" });
      }
      return false;
    }

    if (message?.type === "BB2_START_SEND_BUTTON_PICKER") {
      try {
        startSendButtonPicker();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message, code: error.code || "CONTENT_ADAPTER_ERROR" });
      }
      return false;
    }

    if (message?.type === "BB2_SET_SEND_BUTTON_PROFILE") {
      sendButtonProfile = message.profile || null;
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BB2_SET_COPY_BUTTON_PROFILE") {
      replaceCopyButtonProfiles(message.profile || null, "worker_legacy_profile_update");
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BB2_SET_COPY_BUTTON_PROFILES") {
      replaceCopyButtonProfiles(message.profiles || null, "worker_profiles_update");
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BB2_APPLY_MANUAL_MODE") {
      applyManualMode(message.enabled === true, message.reason || "worker");
      sendResponse({ ok: true, enabled: manualModeEnabled });
      return false;
    }

    if (message?.type === "BB2_SHOW_STATUS") {
      showStatus(message.text || "Business Bridge 2", message.tone || "neutral");
      sendResponse({ ok: true });
      return false;
    }

    sendResponse({ ok: false, error: "Unknown BB2 content message." });
    return false;
  });

  recordContentDiagnostic("CONTENT_RUNTIME_STARTED", { runtime_id: runtimeId, identity: identity(), version: VERSION });
  sendRuntime("BB2_GET_MANUAL_MODE", { identity: identity() }).then((response) => {
    applyManualMode(response.ok && response.enabled === true, "content_start");
  }).catch(() => null);
  Promise.all([
    sendRuntime("BB2_GET_SEND_BUTTON_PROFILE"),
    sendRuntime("BB2_GET_COPY_BUTTON_PROFILE")
  ]).then(([sendResponse, copyResponse]) => {
    sendButtonProfile = sendResponse.ok ? sendResponse.profile || null : null;
    replaceCopyButtonProfiles(copyResponse.ok ? (copyResponse.profiles || copyResponse.profile || null) : null, "content_start_profiles");
  }).finally(() => {
    sendRuntime("BB2_CONTENT_READY", { identity: identity() }).then((response) => {
      recordContentDiagnostic("CONTENT_READY_RESULT", { matched: response?.matched === true, owner: response?.owner ?? null, run_id: response?.run_id || null, status: response?.status || null, error: response?.error || null });
    }).catch(() => null);
  });
