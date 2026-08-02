$("exportSettings").addEventListener("click", async () => {
  try {
    await withButtonFeedback("exportSettings", "Экспортирую…", async () => {
      const response = await request("BB2_EXPORT_SETTINGS");
      if (!response.ok) throw new Error(response.error);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadJson(`business-bridge-2-settings-${stamp}.json`, response.backup);
      $("backupMeta").textContent = `Экспортировано Legacy: ${response.backup.profile_count}; Direct: ${response.backup.direct_profile_count || 0}. Direct private keys в backup не входят; файл содержит Legacy tokens.`;
      setStatus("Настройки экспортированы. Файл является секретом.", "success");
    }, "Экспортировано ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("chooseImport").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    const response = await request("BB2_IMPORT_SETTINGS", { backup });
    if (!response.ok) throw new Error(response.error);
    $("backupMeta").textContent = `Импортировано Legacy: ${response.imported_profiles}; Direct: ${response.imported_direct_profiles || 0}; сохранено активных runs: ${response.preserved_active_runs}.`;
    setStatus("Настройки импортированы.", "success");
    await loadState();
  } catch (error) {
    setStatus(`Импорт не выполнен: ${error.message}`, "error");
  } finally {
    $("importFile").value = "";
  }
});

$("reportPrefixEnabled").addEventListener("change", () => {
  const enabled = $("reportPrefixEnabled").checked;
  $("reportPrefixText").disabled = !enabled;
  $("reportPrefixInterval").disabled = !enabled;
  setStatus(enabled ? "Префикс включён в форме. Нажми «Применить настройки»." : "Префикс выключен в форме. Нажми «Применить настройки».", "warning");
});

$("reportAttachmentFile").addEventListener("change", async () => {
  const file = $("reportAttachmentFile").files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    $("reportAttachmentFile").value = "";
    return setStatus("Файл контекста больше 8 МБ.", "error");
  }
  pendingAttachment = {
    file_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    data_url: await readFileAsDataUrl(file)
  };
  $("reportAttachmentState").textContent = `${file.name} (${file.size} байт) — ожидает применения`;
});

$("clearReportAttachment").addEventListener("click", async () => {
  try {
    await withButtonFeedback("clearReportAttachment", "Удаляю…", async () => {
      pendingAttachment = null;
      const response = await request("BB2_CLEAR_REPORT_ATTACHMENT", { context: popupContext() });
      if (!response.ok) throw new Error(response.error);
      await loadState({ loadCatalog: false });
      setStatus("Файл контекста удалён.", "success");
    }, "Удалено ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("applyNextSettings").addEventListener("click", async () => {
  const applyButton = $("applyNextSettings");
  const feedback = $("nextSettingsFeedback");
  applyButton.disabled = true;
  applyButton.textContent = "Сохраняю…";
  feedback.textContent = "Сохранение…";
  feedback.className = "button-feedback";
  const payload = {
    context: popupContext(),
    executor_id: $("executor").value,
    focus_policy: $("focusPolicy").value,
    wait_for_selected_executor: $("waitRecovery").checked,
    attachment_interval: Number($("reportAttachmentInterval").value || 1),
    attachment: pendingAttachment,
    report_prefix_enabled: $("reportPrefixEnabled").checked,
    report_prefix_text: $("reportPrefixText").value,
    report_prefix_interval: Number($("reportPrefixInterval").value || 1)
  };
  const response = await request("BB2_APPLY_NEXT_ITERATION_SETTINGS", payload);
  if (!response.ok) {
    applyButton.disabled = false;
    applyButton.textContent = "Применить настройки";
    feedback.textContent = "Ошибка сохранения ✕";
    feedback.className = "button-feedback error";
    return setStatus(response.error, "error");
  }
  pendingAttachment = null;
  $("reportAttachmentFile").value = "";
  applyButton.disabled = false;
  applyButton.textContent = "Сохранено ✓";
  feedback.textContent = "Сохранено ✓";
  feedback.className = "button-feedback success";
  setStatus("Настройки следующей итерации сохранены.", "success");
  await loadState({ loadCatalog: false });
  setTimeout(() => {
    if (feedback.textContent === "Сохранено ✓") {
      applyButton.textContent = "Применить настройки";
      feedback.textContent = "";
      feedback.className = "button-feedback";
    }
  }, 5000);
});

$("manualMode").addEventListener("change", async () => {
  const enabled = $("manualMode").checked;
  $("manualMode").disabled = true;
  setStatus(enabled ? "Включаю ручной режим…" : "Отключаю ручной режим…");
  const response = await request("BB2_SET_MANUAL_MODE", { enabled, context: popupContext() });
  $("manualMode").disabled = false;
  if (!response.ok) {
    $("manualMode").checked = !enabled;
    setStatus(response.error || "Не удалось изменить ручной режим.", "error");
    return;
  }
  setStatus(enabled
    ? "Ручной режим включён: обрабатываются три последних блока, затем только новые DOM-узлы."
    : "Ручной режим выключен: observer отключён, стили и обработчики сняты.",
    "success");
  await loadState({ loadCatalog: false });
});

async function startRunAction() {
  if (state?.manual_mode === true) {
    throw Object.assign(new Error("Сначала отключите ручной режим writing blocks."), { code: "MANUAL_MODE_ACTIVE" });
  }
  const profileId = $("profile").value;
  const executorId = $("executor").value;
  if (!profileId || !executorId) throw new Error("Выбери Bridge-профиль и CLI.");
  setStatus("Создаю Bridge2 chain и запускаю отправку «поехали»…");
  const response = await request("BB2_START_RUN", { profile_id: profileId, executor_id: executorId, context: popupContext() });
  if (!response.ok) throw new Error(response.error);
  setStatus(`Run создан: ${response.data.run_id}.`, response.data.warning ? "warning" : "success");
  await loadState({ loadCatalog: false });
  return response.data;
}

async function pauseRunAction() {
  const response = await request("BB2_PAUSE_RUN", { context: popupContext() });
  if (!response.ok) throw new Error(response.error);
  const pausePending = response.data?.pause_pending === true;
  setStatus(pausePending
    ? "Пауза запрошена: текущая задача и доставка завершатся, затем авторабота остановится."
    : "Авторежим приостановлен. Run на операторской паузе.", "success");
  await loadState({ loadCatalog: false });
  return response.data;
}

async function resumeRunAction() {
  const response = await request("BB2_RESUME_RUN", { context: popupContext() });
  if (!response.ok) throw new Error(response.error);
  setStatus("Авторежим продолжен.", "success");
  await loadState({ loadCatalog: false });
  return response.data;
}

async function stopRunAction() {
  const response = await request("BB2_STOP_RUN", { context: popupContext() });
  if (!response.ok) throw new Error(response.error);
  setStatus("Run жёстко завершён.", "success");
  await loadState({ loadCatalog: false });
  return response.data;
}

$("start").addEventListener("click", async () => {
  try { await withButtonFeedback("start", "Запускаю…", startRunAction, "Запущено ✓"); }
  catch (error) { setStatus(error.message, "error"); await loadState({ loadCatalog: false }); }
});
$("pause").addEventListener("click", async () => {
  try { await withButtonFeedback("pause", "Ставлю паузу…", pauseRunAction, "Пауза ✓"); }
  catch (error) { setStatus(error.message, "error"); await loadState({ loadCatalog: false }); }
});
$("resume").addEventListener("click", async () => {
  try { await withButtonFeedback("resume", "Продолжаю…", resumeRunAction, "Продолжено ✓"); }
  catch (error) { setStatus(error.message, "error"); await loadState({ loadCatalog: false }); }
});
$("stop").addEventListener("click", async () => {
  try { await withButtonFeedback("stop", "Завершаю…", stopRunAction, "Завершено ✓"); }
  catch (error) { setStatus(error.message, "error"); await loadState({ loadCatalog: false }); }
});

function diagnosticsForFilter() {
  const filter = $("diagnosticsFilter")?.value || "current";
  const currentRunId = state?.active_run?.run_id || null;
  if (filter === "all") return lastDiagnostics;
  if (filter === "http") return lastDiagnostics.filter((item) => String(item.event || "").startsWith("HTTP_REQUEST_"));
  if (filter === "errors") return lastDiagnostics.filter((item) => {
    const level = String(item.level || "").toLowerCase();
    const event = String(item.event || "").toUpperCase();
    return ["error", "warning"].includes(level) || /(ERROR|FAILED|BLOCKED|TIMEOUT|CONFLICT|REJECTED)/.test(event);
  });
  if (!currentRunId) return lastDiagnostics.filter((item) => !item.run_id).slice(-120);
  return lastDiagnostics.filter((item) => !item.run_id || item.run_id === currentRunId);
}

function renderDiagnostics() {
  const filtered = diagnosticsForFilter();
  $("diagnosticsCount").textContent = String(lastDiagnostics.length);
  $("diagnosticsMeta").textContent = `Показано ${Math.min(filtered.length, 250)} из ${lastDiagnostics.length}; последний sequence: ${lastDiagnostics.at(-1)?.sequence || 0}.`;
  $("diagnostics").textContent = JSON.stringify(filtered.slice(-250), null, 2);
}

async function loadDiagnostics(_show = true, silent = false) {
  const response = await request("BB2_GET_DIAGNOSTICS", {}, 5000);
  if (!response.ok) {
    if (!silent) setStatus(response.error, "error");
    return JSON.stringify({ error: response.error }, null, 2);
  }
  lastDiagnostics = Array.isArray(response.diagnostics) ? response.diagnostics : [];
  renderDiagnostics();
  return $("diagnostics").textContent;
}

function downloadDiagnostics() {
  const payload = {
    format: "business-bridge-2-diagnostics",
    exported_at: new Date().toISOString(),
    extension_version: "2.0.0.21",
    current_run_id: state?.active_run?.run_id || null,
    events: lastDiagnostics
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `business-bridge-2-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("loadDiagnostics").addEventListener("click", async () => {
  try { await withButtonFeedback("loadDiagnostics", "Обновляю…", () => loadDiagnostics(true), "Обновлено ✓"); }
  catch (error) { setStatus(error.message, "error"); }
});
$("diagnosticsFilter").addEventListener("change", renderDiagnostics);
$("copyDiagnostics").addEventListener("click", async () => {
  try {
    await withButtonFeedback("copyDiagnostics", "Копирую…", async () => {
      await loadDiagnostics(true, true);
      await navigator.clipboard.writeText($("diagnostics").textContent || "[]");
      setStatus("Показанный журнал скопирован.", "success");
    }, "Скопировано ✓");
  } catch (error) { setStatus(error.message, "error"); }
});
$("downloadDiagnostics").addEventListener("click", async () => {
  try {
    await withButtonFeedback("downloadDiagnostics", "Готовлю…", async () => {
      await loadDiagnostics(true, true);
      downloadDiagnostics();
      setStatus("Полный журнал сохранён в JSON.", "success");
    }, "Сохранено ✓");
  } catch (error) { setStatus(error.message, "error"); }
});
$("clearDiagnostics").addEventListener("click", async () => {
  try {
    await withButtonFeedback("clearDiagnostics", "Очищаю…", async () => {
      const response = await request("BB2_CLEAR_DIAGNOSTICS");
      if (!response.ok) throw new Error(response.error);
      lastDiagnostics = [];
      renderDiagnostics();
      setStatus("Журнал очищен.", "success");
    }, "Очищено ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

loadState().then(() => loadDiagnostics(true, true)).catch((error) => setStatus(error.message, "error"));
diagnosticsTimer = setInterval(() => loadDiagnostics(true, true).catch(() => null), 1500);
window.addEventListener("unload", () => { if (diagnosticsTimer) clearInterval(diagnosticsTimer); });
