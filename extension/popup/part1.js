"use strict";

const $ = (id) => document.getElementById(id);
let state = null;
let executors = [];
let editingProfileId = null;
let directBundlePreview = null;
let pendingAttachment = null;
let lastDiagnostics = [];
let diagnosticsTimer = null;
let actionSequence = 0;

function request(type, payload = {}, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: `Runtime request ${type} timed out after ${timeoutMs} ms.`, code: "POPUP_RUNTIME_TIMEOUT" });
    }, timeoutMs);
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const error = chrome.runtime.lastError;
      if (error) resolve({ ok: false, error: error.message, code: "POPUP_RUNTIME_ERROR" });
      else resolve(response || { ok: false, error: "Empty response.", code: "POPUP_EMPTY_RESPONSE" });
    });
  });
}

function setStatus(text, tone = "") {
  $("status").textContent = text || "";
  $("status").className = `status ${tone}`.trim();
}

function markButton(button, stateName, temporaryText = null) {
  if (!(button instanceof HTMLButtonElement)) return;
  button.classList.remove("is-loading", "is-success", "is-error");
  if (stateName) button.classList.add(`is-${stateName}`);
  if (temporaryText !== null) button.textContent = temporaryText;
}

async function withButtonFeedback(buttonOrId, pendingText, action, successText = "Готово ✓") {
  const button = typeof buttonOrId === "string" ? $(buttonOrId) : buttonOrId;
  const sequence = ++actionSequence;
  const originalText = button?.textContent || "";
  if (button) { button.disabled = true; markButton(button, "loading", pendingText); button.setAttribute("aria-busy", "true"); }
  try {
    const result = await action();
    if (button) { markButton(button, "success", successText); button.removeAttribute("aria-busy"); }
    setTimeout(() => {
      if (sequence <= actionSequence && button?.isConnected) {
        markButton(button, "", originalText);
        if (state) renderRun();
      }
    }, 1400);
    return result;
  } catch (error) {
    if (button) { markButton(button, "error", "Ошибка ✕"); button.removeAttribute("aria-busy"); }
    setTimeout(() => {
      if (button?.isConnected) {
        markButton(button, "", originalText);
        if (state) renderRun();
      }
    }, 1800);
    throw error;
  } finally {
    if (button?.isConnected) button.disabled = false;
    if (state) renderRun();
  }
}

function selectedProfile() {
  return state?.profiles?.find((item) => item.profile_id === $("profile").value) || null;
}

function selectedDirectProfile() {
  return state?.direct_profiles?.find((item) => item.profile_id === $("directProfile").value) || null;
}

function directPermissionPattern(profile) {
  const host = profile?.host;
  if (!host || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) throw new Error("Direct host is invalid.");
  return `http://${host}/*`;
}

async function requestDirectHostPermission(profile) {
  if (!chrome.permissions?.request) throw new Error("Chrome host permissions API is unavailable.");
  const pattern = directPermissionPattern(profile);
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error(`Доступ к ${profile.host} не разрешён. Direct-профиль не изменён.`);
  return pattern;
}

function renderDirectProfiles() {
  const select = $("directProfile");
  const previous = select.value;
  select.innerHTML = "";
  const profiles = state?.direct_profiles || [];
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.profile_id;
    option.textContent = `${profile.name} — ${profile.connection_state || "DISCONNECTED"}`;
    select.appendChild(option);
  }
  if (previous && profiles.some((profile) => profile.profile_id === previous)) select.value = previous;
  if (!profiles.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Direct-профилей пока нет";
    select.appendChild(option);
  }
  const profile = selectedDirectProfile();
  $("directRename").value = profile?.name || "";
  if (!profile) {
    $("directProfileMeta").textContent = "Сначала импортируйте BB2D1 bundle и подтвердите identity.";
    return;
  }
  const warning = profile.identity_warning ? ` ⚠ ${profile.identity_warning}` : "";
  const keyState = profile.has_private_key ? "device key: локально" : "device key: отсутствует";
  $("directProfileMeta").textContent = `${profile.origin} · ${profile.device_status} · ${profile.connection_state} · ${keyState} · ${profile.server_fingerprint}${warning}`;
}

function popupContext() {
  if (!state?.tab?.id || !state?.identity?.origin) throw new Error("Popup context is unavailable.");
  return {
    tab_id: state.tab.id,
    origin: state.identity.origin,
    conversation_id: state.identity.conversation_id || null
  };
}

function formatRun(run) {
  return [
    `Run: ${run.run_id}`,
    `Статус: ${run.status}`,
    `CLI: ${run.executor_id}`,
    `Сервер: ${run.current_server?.name || run.current_server?.endpoint || "?"}`,
    `Job: ${run.current_job_id || "—"}`,
    `Последняя задача: ${run.last_job_id || run.current_job_id || "—"}`,
    `Итерация: ${run.sequence}`,
    run.error ? `Ошибка: ${run.error.message || run.error.code}` : ""
  ].filter(Boolean).join("\n");
}

function renderProfiles() {
  const select = $("profile");
  const selected = state.bound_profile_id || state.default_profile_id || state.profiles[0]?.profile_id || "";
  select.innerHTML = "";
  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.profile_id;
    option.textContent = profile.name;
    option.selected = profile.profile_id === selected;
    select.appendChild(option);
  }
  if (!state.profiles.length) {
    const option = document.createElement("option");
    option.textContent = "Добавь Bridge-профиль";
    option.value = "";
    select.appendChild(option);
  }
  renderProfileMeta();
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ru-RU");
}

function renderTransport(transport = state?.transport) {
  const target = $("connectionState");
  const meta = $("connectionMeta");
  const current = transport || { state: "unknown" };
  target.className = "connection-state";
  if (current.state === "disconnected") {
    target.textContent = "Соединение потеряно";
    target.classList.add("connection-error");
    meta.textContent = [
      `Ошибка: ${current.last_error_message || current.last_error_code || "Сервер недоступен"}`,
      `Последняя успешная связь: ${formatTimestamp(current.last_success_at)}`,
      `Следующая проверка: ${formatTimestamp(current.retry_at)}`
    ].join(" · ");
    return;
  }
  if (current.state === "connected") {
    target.textContent = "Подключено";
    target.classList.add("connection-ok");
    meta.textContent = `Последняя успешная связь: ${formatTimestamp(current.last_success_at)}`;
    return;
  }
  target.textContent = current.state === "recovering" ? "Восстановление…" : "Не проверено";
  target.classList.add("connection-unknown");
  meta.textContent = "Состояние соединения ещё не подтверждено.";
}

function renderProfileMeta() {
  const profile = selectedProfile();
  if (!editingProfileId && profile) {
    $("profileName").value = profile.name || "";
    $("endpoint").value = profile.endpoint || "";
  }
  $("profileMeta").textContent = profile
    ? `${profile.endpoint} · instance ${profile.bridge_instance_id} · rev ${profile.profile_revision}`
    : "Профиль не выбран.";
  $("identityState").textContent = profile?.bridge_instance_id || "—";
}

function renderExecutors() {
  const select = $("executor");
  const preferred = state?.next_iteration_config?.executor_id || select.value;
  select.innerHTML = "";
  for (const executor of executors) {
    const option = document.createElement("option");
    option.value = executor.executor_id;
    option.textContent = `${executor.display_name || executor.executor_id} — ${executor.health || "unknown"}`;
    option.disabled = executor.configured === false || executor.enabled === false;
    select.appendChild(option);
  }
  if (preferred && [...select.options].some((option) => option.value === preferred && !option.disabled)) select.value = preferred;
  if (!executors.length) {
    const option = document.createElement("option");
    option.textContent = "Каталог CLI не загружен";
    option.value = "";
    select.appendChild(option);
  }
}

function renderSettings() {
  const config = state.next_iteration_config || {};
  $("focusPolicy").value = config.focus_policy || "report_only";
  $("waitRecovery").checked = config.wait_for_selected_executor !== false;
  const attachment = state.report_attachment || null;
  $("reportAttachmentState").textContent = attachment?.file_name
    ? `${attachment.file_name} (${attachment.size_bytes || 0} байт)`
    : "Не выбран";
  $("reportAttachmentInterval").value = String(attachment?.interval || 1);
  $("reportAttachmentHint").textContent = attachment?.file_name
    ? `Доставлено отчётов: ${attachment.delivered_count || 0}; последнее успешное вложение: ${attachment.last_attached_at_count || 0}.`
    : "Если загрузка контекста не удалась, сам отчёт всё равно отправляется, а файл остаётся ожидающим следующего отчёта.";
  const prefix = state.report_prefix || null;
  $("reportPrefixEnabled").checked = prefix?.enabled === true;
  $("reportPrefixText").value = prefix?.text || "";
  $("reportPrefixInterval").value = String(prefix?.interval || 1);
  $("reportPrefixText").disabled = prefix?.enabled !== true;
  $("reportPrefixInterval").disabled = prefix?.enabled !== true;
  $("reportPrefixHint").textContent = prefix
    ? `Доставлено отчётов: ${prefix.delivered_count || 0}; последнее применение префикса: ${prefix.last_applied_at_count || 0}.`
    : "N = 1 — префикс добавляется перед каждым доставленным отчётом, включая отчёты об ошибках CLI.";
}

function renderRun() {
  const run = state.active_run;
  $("activeRunCount").textContent = String(state.active_run_count || 0);
  $("activeRuns").textContent = state.active_runs?.length
    ? state.active_runs.map(formatRun).join("\n\n")
    : "Нет активных runs.";
  if (!run) {
    $("runCard").textContent = "Активного run нет.";
    $("runState").textContent = "Не запущен";
    $("activeExecutorState").textContent = "Нет активной задачи";
    $("currentIterationStatus").textContent = "Не запущена";
    $("resourcePolicyState").textContent = "—";
  } else {
    $("runCard").textContent = formatRun(run);
    $("runState").textContent = run.pause_requested ? `${run.status} · пауза после отчёта` : run.status;
    $("activeExecutorState").textContent = run.executor_id || "—";
    $("currentIterationStatus").textContent = run.pause_requested ? `${run.status} · пауза ожидает отчёт` : run.status;
    $("resourcePolicyState").textContent = run.wait_for_selected_executor === false
      ? "Разрешён автоматический переход на доступную CLI"
      : "Ждать выбранную CLI";
  }
  $("sendButtonState").textContent = state.send_button_profile ? "Выбрана" : "Не выбрана";
  const builtinCopyAdapters = Number(state.copy_button_builtin_adapter_count || 2);
  const customCopyProfiles = Number(state.copy_button_profile_count || state.copy_button_profiles?.profiles?.length || 0);
  $("copyButtonState").textContent = customCopyProfiles > 0
    ? `${builtinCopyAdapters} встроенных + ${customCopyProfiles} выбранных`
    : `${builtinCopyAdapters} встроенных`;
  const boundProfile = state.profiles?.find((profile) => profile.profile_id === state.bound_profile_id) || null;
  const bindingBanner = $("bindingBanner");
  bindingBanner.classList.toggle("bound", Boolean(boundProfile));
  bindingBanner.classList.toggle("unbound", !boundProfile);
  $("bindingState").textContent = boundProfile ? "Диалог привязан" : "Диалог не привязан";
  $("bindingMeta").textContent = boundProfile
    ? `${boundProfile.name} · ${boundProfile.endpoint}`
    : "Выбери профиль и нажми «Привязать диалог».";
  $("bind").textContent = boundProfile ? "Перепривязать диалог" : "Привязать диалог";
  const manualModeActive = state.manual_mode === true;
  $("manualMode").checked = manualModeActive;
  const manualState = state.manual_button_state || {};
  $("manualModeMeta").textContent = manualModeActive
    ? `Включен: авторежим заблокирован до отключения ручного режима. Синие Copy-кнопки у трёх последних и новых blocks. ${manualState.enabled === true ? (manualState.title || "Ручная отправка готова.") : (manualState.title || "Bridge-отправка сейчас недоступна; обычное копирование сохраняется.")}`
    : "Выключен: страница не наблюдается и Copy-кнопки не изменяются.";
  $("latestTask").textContent = state.latest_task_id || "—";
  $("latestTaskMirror").textContent = state.latest_task_id || "—";
  $("pageMonitor").textContent = state.page_monitor?.ok
    ? `Готов · content ${state.page_monitor.content_script_version || "?"}`
    : (state.page_monitor?.error || "Недоступен");
  $("start").disabled = Boolean(run) || manualModeActive || !$("profile").value || !$("executor").value;
  $("start").title = manualModeActive ? "Сначала отключите ручной режим writing blocks." : "";
  $("pause").disabled = !run || run.pause_requested === true || run.status === "starting" || run.status === "paused" || ["stopped", "error"].includes(run.status);
  $("resume").disabled = !run || run.status !== "paused" || (run.pause_reason && run.pause_reason !== "operator");
  $("stop").disabled = !run;
}

async function loadState({ loadCatalog = true } = {}) {
  setStatus("Загружаю состояние…");
  const response = await request("BB2_POPUP_STATE");
  if (!response.ok) {
    setStatus(response.error || "Не удалось загрузить состояние.", "error");
    return;
  }
  state = response.data;
  $("context").textContent = state.identity.conversation_id
    ? `Диалог ${state.identity.conversation_id}`
    : "Новый диалог: профиль закрепится после появления conversation_id";
  renderProfiles();
  renderDirectProfiles();
  renderTransport(state.transport);
  renderSettings();
  if (loadCatalog && $("profile").value) await refreshExecutors();
  else renderExecutors();
  renderRun();
  setStatus("");
}
