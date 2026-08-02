chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "BB2_CONTENT_READY":
        return await handleContentReady(message, sender);
      case "BB2_POPUP_STATE":
        return { ok: true, data: await getPopupState() };
      case "BB2_GET_MANUAL_BUTTON_STATE": {
        const tabId = sender?.tab?.id || message.tab_id;
        if (!Number.isInteger(tabId)) return { ok: false, error: "ChatGPT tab is unavailable." };
        const here = message.identity || await tabIdentity(tabId);
        return { ok: true, state: await manualButtonStateForContext(here, tabId) };
      }
      case "BB2_GET_MANUAL_MODE": {
        const tabId = sender?.tab?.id || message.tab_id;
        if (!Number.isInteger(tabId)) return { ok: false, error: "ChatGPT tab is unavailable." };
        const here = message.identity || await tabIdentity(tabId);
        return { ok: true, enabled: await getManualModeForContext(here, tabId) };
      }
      case "BB2_SET_MANUAL_MODE": {
        const context = await resolvePopupContext(message.context);
        const result = await setManualModeForContext(context.identity, context.tab.id, message.enabled === true);
        const applied = await tabMessage(context.tab.id, {
          type: "BB2_APPLY_MANUAL_MODE",
          enabled: result.enabled,
          reason: "popup_toggle"
        }, 5000).catch((error) => ({ ok: false, error: error.message }));
        await diagnostic(result.enabled ? "MANUAL_MODE_ENABLED_BY_OPERATOR" : "MANUAL_MODE_DISABLED_BY_OPERATOR", {
          conversation_id: context.identity.conversation_id || null,
          tab_id: context.tab.id,
          content_applied: applied?.ok === true,
          content_error: applied?.ok === true ? null : (applied?.error || null)
        });
        return {
          ok: true,
          data: {
            enabled: result.enabled,
            content_applied: applied?.ok === true,
            state: await manualButtonStateForContext(context.identity, context.tab.id)
          }
        };
      }
      case "BB2_MANUAL_SUBMIT_WRITING_BLOCK":
        return { ok: true, data: await submitManualWritingBlock(message, sender) };
      case "BB2_DIRECT_PAIR": {
        requireTrustedExtensionSender(sender);
        return { ok: true, profile: await pairDirectProfile(message) };
      }
      case "BB2_DIRECT_STATUS": {
        requireTrustedExtensionSender(sender);
        return { ok: true, profile: await directLifecycle(message.profile_id, "status", { connect: false }) };
      }
      case "BB2_DIRECT_CONNECT": {
        requireTrustedExtensionSender(sender);
        return { ok: true, profile: await directLifecycle(message.profile_id, "status", { connect: true }) };
      }
      case "BB2_DIRECT_DISCONNECT": {
        requireTrustedExtensionSender(sender);
        return { ok: true, profile: await disconnectDirectProfile(message.profile_id) };
      }
      case "BB2_DIRECT_RENAME": {
        requireTrustedExtensionSender(sender);
        return { ok: true, profile: await renameDirectProfile(message.profile_id, message.name) };
      }
      case "BB2_DIRECT_REVOKE": {
        requireTrustedExtensionSender(sender);
        return { ok: true, profile: await directLifecycle(message.profile_id, "revoke", { connect: false }) };
      }
      case "BB2_DIRECT_DELETE": {
        requireTrustedExtensionSender(sender);
        return { ok: true, data: await deleteDirectProfile(message.profile_id, message.force === true) };
      }
      case "BB2_CHECK_CONNECTION": {
        const { profiles, credentials } = await getProfilesAndCredentials();
        const profile = profiles[message.profile_id];
        if (!profile) throw new Error("Profile not found.");
        const token = credentials[profile.credential_ref];
        if (!token) throw new Error("Profile token missing.");
        const identity = await validateProfile(profile, token);
        const catalog = await getExecutors(profile.profile_id);
        return {
          ok: true,
          data: {
            instance_id: identity.instance_id,
            api_contract: identity.api_contract,
            server_version: identity.server_version,
            deployment_revision: identity.deployment_revision,
            executor_count: (catalog.executors || []).length,
            freshness: catalog.freshness
          }
        };
      }
      case "BB2_APPLY_NEXT_ITERATION_SETTINGS": {
        const context = await resolvePopupContext(message.context);
        const result = await saveConversationSettings(context.identity, context.tab.id, message);
        await diagnostic("NEXT_ITERATION_SETTINGS_SAVED", {
          conversation_id: context.identity.conversation_id,
          tab_id: context.tab.id,
          executor_id: result.next.executor_id,
          focus_policy: result.next.focus_policy,
          wait_for_selected_executor: result.next.wait_for_selected_executor,
          has_attachment: Boolean(result.attachment),
          report_prefix_enabled: result.report_prefix?.enabled === true,
          report_prefix_interval: result.report_prefix?.interval || 1
        });
        return { ok: true, data: result };
      }
      case "BB2_CLEAR_REPORT_ATTACHMENT": {
        const context = await resolvePopupContext(message.context);
        await clearConversationAttachment(context.identity, context.tab.id);
        await diagnostic("REPORT_ATTACHMENT_CLEARED", { conversation_id: context.identity.conversation_id, tab_id: context.tab.id });
        return { ok: true };
      }
      case "BB2_EXPORT_SETTINGS":
        return { ok: true, backup: await exportSettingsBackup() };
      case "BB2_IMPORT_SETTINGS": {
        const result = await importSettingsBackup(message.backup);
        return { ok: true, ...result };
      }
      case "BB2_SAVE_PROFILE":
        return { ok: true, profile: await addOrUpdateProfile(message) };
      case "BB2_SET_DEFAULT_PROFILE": {
        const { profiles } = await getProfilesAndCredentials();
        if (!profiles[message.profile_id]) throw new Error("Profile not found.");
        await withStorageLock("profiles", async () => storageSet({ [KEYS.DEFAULT_PROFILE]: message.profile_id }));
        return { ok: true };
      }
      case "BB2_BIND_PROFILE": {
        const context = await resolvePopupContext(message.context);
        const { profiles } = await getProfilesAndCredentials();
        if (!profiles[message.profile_id]) throw new Error("Profile not found.");
        await bindProfileToIdentity(message.profile_id, context.identity, context.tab.id);
        return { ok: true };
      }
      case "BB2_GET_EXECUTORS":
        return { ok: true, data: await getExecutors(message.profile_id) };
      case "BB2_REFRESH_EXECUTORS":
        return { ok: true, data: await refreshExecutorsNow(message.profile_id) };
      case "BB2_START_RUN":
        return { ok: true, data: await startRun(message) };
      case "BB2_PAUSE_RUN": {
        const context = await resolvePopupContext(message.context);
        return { ok: true, data: await pauseActiveRun(context.identity, context.tab.id) };
      }
      case "BB2_RESUME_RUN": {
        const context = await resolvePopupContext(message.context);
        return { ok: true, data: await resumeActiveRun(context.identity, context.tab.id) };
      }
      case "BB2_STOP_RUN": {
        const context = await resolvePopupContext(message.context);
        return { ok: true, data: await stopActiveRun(context.identity, context.tab.id) };
      }
      case "BB2_PROMPT_READY":
        return await handlePromptReady(message);
      case "BB2_PROMPT_MANUAL_INTERRUPTION": {
        const run = await getRun(message.run_id);
        if (!run) return { ok: false, error: "Run not found." };
        await pauseActiveRun({ origin: run.origin, conversation_id: run.conversation_id }, run.tab_id, "manual_user_turn");
        return { ok: true, paused: true };
      }
      case "BB2_START_ABORT_COMMIT": {
        return await withRunLock(message.run_id, async () => {
          let run = await getRun(message.run_id);
          if (!run) return { ok: false, error: "Run not found." };
          if (sender.tab?.id !== run.tab_id) return { ok: false, error: "Start abort came from another tab." };
          if (message.click_method_called === true) {
            await diagnostic("START_ABORT_FORBIDDEN_AFTER_CLICK_METHOD", { run_id: run.run_id, reason: message.reason || null }, { level: "warning" });
            return { ok: false, aborted: false, code: "START_ABORT_FORBIDDEN_AFTER_CLICK_METHOD", error: "Start click method was already called; automatic resend is forbidden." };
          }
          if (run.start_delivery?.phase !== "committed" || run.status !== BB2Model.RUN_STATUSES.STARTING) {
            return { ok: true, aborted: false };
          }
          run = BB2Model.evolveRun(run, {
            status: BB2Model.RUN_STATUSES.STARTING,
            start_delivery: { phase: "none", previous_user_turn_id: null, committed_at: null },
            error: { code: "START_COMMIT_ABORTED_BEFORE_CLICK", message: String(message.reason || "Start click was not dispatched.") }
          });
          await saveRun(run);
          await diagnostic("START_COMMIT_ABORTED_BEFORE_CLICK", { run_id: run.run_id, reason: message.reason || null });
          return { ok: true, aborted: true };
        });
      }
      case "BB2_START_COMMIT_REQUEST":
        return await withRunLock(message.run_id, async () => {
          let run = await getRun(message.run_id);
          if (!run) return { ok: false, error: "Run not found." };
          if (run.start_delivery?.phase === "committed" || run.start_delivery?.phase === "confirmed") {
            return { ok: true, committed: true };
          }
          if (run.status !== BB2Model.RUN_STATUSES.STARTING) return { ok: false, error: "Run is not in start preparation." };
          run = BB2Model.commitStart(run, message.previous_user_turn_id || null);
          await saveRun(run);
          await diagnostic("START_COMMITTED_BEFORE_CLICK", { run_id: run.run_id, previous_user_turn_id: message.previous_user_turn_id || null });
          return { ok: true, committed: true };
        });
      case "BB2_DELIVERY_COMMIT_REQUEST":
        return await withRunLock(message.run_id, async () => {
          let run = await getRun(message.run_id);
          if (!run) return { ok: false, error: "Run not found." };
          if (run.delivery?.delivery_id !== message.delivery_id) return { ok: false, error: "Delivery mismatch." };
          if (run.delivery.phase === BB2Model.DELIVERY_PHASES.COMMITTED) return { ok: true, committed: true };
          if ([BB2Model.RUN_STATUSES.PAUSED, BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR].includes(run.status)) {
            return { ok: false, error: "Run is paused, stopped or errored before delivery commit." };
          }
          if (run.delivery.phase !== BB2Model.DELIVERY_PHASES.CLAIMED) return { ok: false, error: "Delivery not claimable." };
          const token = await tokenForSnapshot(run.profile_snapshot);
          await bridgeFetch(run.profile_snapshot, token, `/v2/jobs/${encodeURIComponent(run.delivery.job_id)}/delivery/commit`, {
            method: "POST",
            run_id: run.run_id,
            body: { delivery_id: run.delivery.delivery_id, client_id: run.client_installation_id, run_id: run.run_id }
          });
          run = BB2Model.commitDelivery(run);
          await saveRun(run);
          await diagnostic("DELIVERY_COMMITTED_BEFORE_CLICK", { run_id: run.run_id, delivery_id: run.delivery.delivery_id });
          return { ok: true, committed: true };
        });
      case "BB2_CLEAR_COPY_BUTTON_PROFILE": {
        const collection = copyButtonProfileCollection(null);
        await storageSet({
          [KEYS.COPY_BUTTON_PROFILE]: null,
          [KEYS.COPY_BUTTON_PROFILES]: collection
        });
        await broadcastCopyButtonProfiles(collection);
        await diagnostic("COPY_BUTTON_PROFILES_CLEARED", {
          builtin_adapter_count: BB2ManualControls.BUILTIN_MANUAL_COPY_ADAPTER_COUNT,
          custom_profile_count: 0
        });
        return { ok: true, profiles: collection };
      }
      case "BB2_GET_COPY_BUTTON_PROFILE": {
        const profiles = await getCopyButtonProfiles();
        return {
          ok: true,
          profile: legacyCompatibleCopyButtonProfile(profiles),
          profiles,
          builtin_adapter_count: BB2ManualControls.BUILTIN_MANUAL_COPY_ADAPTER_COUNT,
          custom_profile_count: profiles.profiles.length
        };
      }
      case "BB2_SAVE_COPY_BUTTON_PROFILE": {
        const profile = message.profile || null;
        const profiles = await appendCopyButtonProfile(profile);
        await broadcastCopyButtonProfiles(profiles);
        const saved = copyButtonProfileWithMetadata(profile);
        await diagnostic("COPY_BUTTON_PROFILE_ADDED", {
          kind: saved?.kind || null,
          adapter_id: saved?.adapter_id || null,
          tag: saved?.tag || null,
          testid: saved?.testid || null,
          aria: saved?.aria || null,
          custom_profile_count: profiles.profiles.length,
          builtin_adapter_count: BB2ManualControls.BUILTIN_MANUAL_COPY_ADAPTER_COUNT
        });
        return { ok: true, profiles, custom_profile_count: profiles.profiles.length };
      }
      case "BB2_CLEAR_SEND_BUTTON_PROFILE": {
        await storageSet({ [KEYS.SEND_BUTTON_PROFILE]: null });
        const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] }).catch(() => []);
        await Promise.all(tabs.map((tab) => tab.id ? tabMessage(tab.id, { type: "BB2_SET_SEND_BUTTON_PROFILE", profile: null }, 1500).catch(() => null) : null));
        await diagnostic("SEND_BUTTON_PROFILE_CLEARED", {});
        return { ok: true };
      }
      case "BB2_GET_SEND_BUTTON_PROFILE": {
        const data = await storageGet(KEYS.SEND_BUTTON_PROFILE);
        return { ok: true, profile: data[KEYS.SEND_BUTTON_PROFILE] || null };
      }
      case "BB2_SAVE_SEND_BUTTON_PROFILE": {
        const profile = message.profile || null;
        if (!profile || profile.kind !== "bb2_manual_send_button_v1") throw new Error("Invalid send button profile.");
        await storageSet({ [KEYS.SEND_BUTTON_PROFILE]: profile });
        const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] }).catch(() => []);
        await Promise.all(tabs.map((tab) => tab.id ? tabMessage(tab.id, { type: "BB2_SET_SEND_BUTTON_PROFILE", profile }, 1500).catch(() => null) : null));
        await diagnostic("SEND_BUTTON_PROFILE_SAVED", { kind: profile.kind, tag: profile.tag, testid: profile.testid, aria: profile.aria });
        return { ok: true };
      }
      case "BB2_GET_DIAGNOSTICS": {
        const data = await storageGet(KEYS.DIAGNOSTICS);
        return { ok: true, diagnostics: data[KEYS.DIAGNOSTICS] || [] };
      }
      case "BB2_CLEAR_DIAGNOSTICS":
        await storageSet({ [KEYS.DIAGNOSTICS]: [] });
        return { ok: true };
      case "BB2_RECORD_DIAGNOSTIC":
        await diagnostic(String(message.event || "CONTENT_DIAGNOSTIC"), {
          source: "content_script",
          tab_id: sender.tab?.id || null,
          ...(message.details || {})
        });
        return { ok: true };
      default:
        return { ok: false, error: "Unknown BB2 message." };
    }
  })().then(sendResponse).catch((error) => {
    diagnostic("MESSAGE_HANDLER_ERROR", { type: message?.type, error: error.message }).catch(() => null);
    sendResponse({ ok: false, error: error.message, code: error.code || "BB2_ERROR" });
  });
  return true;
});

