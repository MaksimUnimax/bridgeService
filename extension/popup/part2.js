async function refreshExecutors({ serverRefresh = false } = {}) {
  const profileId = $("profile").value;
  executors = [];
  renderExecutors();
  renderRun();
  if (!profileId) return;
  setStatus(serverRefresh ? "Запрашиваю background refresh CLI и жду новый snapshot…" : "Читаю cached executor catalog…");
  const response = await request(serverRefresh ? "BB2_REFRESH_EXECUTORS" : "BB2_GET_EXECUTORS", { profile_id: profileId }, serverRefresh ? 18000 : 12000);
  if (!response.ok) {
    $("catalogMeta").textContent = `Ошибка: ${response.error}`;
    const fallbackTransport = response.data?.transport || { state: "disconnected", last_error_message: response.error };
    state.transport = fallbackTransport;
    renderTransport(fallbackTransport);
    setStatus(response.error, "error");
    return;
  }
  executors = response.data.executors || [];
  renderExecutors();
  state.transport = response.data.transport || state.transport;
  renderTransport(state.transport);
  $("catalogMeta").textContent = `freshness: ${response.data.freshness}; checked: ${response.data.checked_at || "—"}; fetched: ${response.data.fetched_at || "—"}${response.data.refresh_state ? `; refresh: ${response.data.refresh_state}` : ""}`;
  renderRun();
  const disconnected = state.transport?.state === "disconnected";
  setStatus(
    disconnected
      ? `Сервер недоступен: ${state.transport.last_error_message || "ошибка соединения"}`
      : (response.data.warning ? `Ошибка каталога CLI: ${response.data.warning}` : ""),
    (disconnected || response.data.error_code) ? "error" : (response.data.warning ? "warning" : "")
  );
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("profile").addEventListener("change", () => {
  renderProfileMeta();
  renderTransport({ state: "unknown" });
  refreshExecutors().catch((error) => setStatus(error.message, "error"));
});
$("refresh").addEventListener("click", async () => {
  try {
    await withButtonFeedback("refresh", "Обновляю…", () => refreshExecutors({ serverRefresh: true }), "CLI обновлены ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("checkConnection").addEventListener("click", async () => {
  const profileId = $("profile").value;
  if (!profileId) return setStatus("Профиль не выбран.", "error");
  try {
    await withButtonFeedback("checkConnection", "Проверяю…", async () => {
      setStatus("Проверяю Bridge identity и cached catalog…");
      const response = await request("BB2_CHECK_CONNECTION", { profile_id: profileId });
      if (!response.ok) throw new Error(response.error);
      $("connectionState").textContent = "Подключено";
      $("identityState").textContent = response.data.instance_id;
      setStatus(`Bridge ${response.data.instance_id}; API ${response.data.api_contract}; executors ${response.data.executor_count}.`, "success");
    }, "Подключено ✓");
  } catch (error) { $("connectionState").textContent = "Ошибка"; setStatus(error.message, "error"); }
});

async function startCopyPicker() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("Активная вкладка ChatGPT не найдена.");
  const response = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "BB2_START_COPY_BUTTON_PICKER" }, (value) => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: error.message } : (value || { ok: false, error: "Picker failed." }));
    });
  });
  if (!response.ok) throw new Error(response.error || "Picker failed.");
  setStatus("Нажми локальную Copy-кнопку внутри writing block. Новый вариант добавится, а прежние сохранятся. Выбор не скопирует и не отправит блок.", "success");
}

$("pickCopy").addEventListener("click", async () => {
  try { await withButtonFeedback("pickCopy", "Жду выбор…", startCopyPicker, "Picker включён ✓"); }
  catch (error) { setStatus(error.message, "error"); }
});

$("clearCopy").addEventListener("click", async () => {
  try {
    await withButtonFeedback("clearCopy", "Сбрасываю…", async () => {
      const response = await request("BB2_CLEAR_COPY_BUTTON_PROFILE");
      if (!response.ok) throw new Error(response.error);
      await loadState({ loadCatalog: false });
      setStatus("Пользовательские Copy-профили сброшены. Два встроенных варианта продолжают работать.", "success");
    }, "Сброшено ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("pickSend").addEventListener("click", async () => {
  try {
    await withButtonFeedback("pickSend", "Жду выбор…", async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.id) throw new Error("Активная вкладка ChatGPT не найдена.");
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: "BB2_START_SEND_BUTTON_PICKER" }, (value) => {
          const error = chrome.runtime.lastError;
          resolve(error ? { ok: false, error: error.message } : (value || { ok: false, error: "Picker failed." }));
        });
      });
      if (!response.ok) throw new Error(response.error || "Picker failed.");
      setStatus("Выбери Send-кнопку прямо в ChatGPT. Тестовое сообщение не отправится.", "success");
    }, "Picker включён ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("clearSend").addEventListener("click", async () => {
  try {
    await withButtonFeedback("clearSend", "Сбрасываю…", async () => {
      const response = await request("BB2_CLEAR_SEND_BUTTON_PROFILE");
      if (!response.ok) throw new Error(response.error);
      await loadState({ loadCatalog: false });
      setStatus("Выбор Send-кнопки сброшен.", "success");
    }, "Сброшено ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("bind").addEventListener("click", async () => {
  const profileId = $("profile").value;
  if (!profileId) return setStatus("Профиль не выбран.", "error");
  try {
    await withButtonFeedback("bind", "Привязываю…", async () => {
      const response = await request("BB2_BIND_PROFILE", { profile_id: profileId, context: popupContext() });
      if (!response.ok) throw new Error(response.error);
      await loadState({ loadCatalog: false });
      setStatus("Диалог привязан к выбранному Bridge-профилю.", "success");
    }, "Диалог привязан ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("newProfile").addEventListener("click", () => {
  editingProfileId = "__new__";
  $("profileName").value = "";
  $("endpoint").value = "";
  $("token").value = "";
  $("makeDefault").checked = false;
  setStatus("Заполни данные нового Bridge-профиля.");
  $("profileEditor").open = true;
});

$("saveProfile").addEventListener("click", async () => {
  try {
    await withButtonFeedback("saveProfile", "Проверяю…", async () => {
      const selected = selectedProfile();
      setStatus("Проверяю Bridge identity…");
      const response = await request("BB2_SAVE_PROFILE", {
        profile_id: editingProfileId === "__new__" ? null : (editingProfileId || selected?.profile_id || null),
        name: $("profileName").value,
        endpoint: $("endpoint").value,
        token: $("token").value,
        make_default: $("makeDefault").checked
      });
      if (!response.ok) throw new Error(response.error);
      $("token").value = "";
      editingProfileId = null;
      await loadState();
      $("profile").value = response.profile.profile_id;
      renderProfileMeta();
      setStatus("Bridge-профиль сохранён.", "success");
    }, "Сохранено ✓");
  } catch (error) { setStatus(error.message, "error"); }
});


$("directIdentityConfirm").addEventListener("change", () => {
  $("pairDirectProfile").disabled = !(directBundlePreview && $("directIdentityConfirm").checked);
});

$("previewDirectBundle").addEventListener("click", async () => {
  directBundlePreview = null;
  $("directIdentityConfirm").checked = false;
  $("directIdentityConfirm").disabled = true;
  $("pairDirectProfile").disabled = true;
  $("directPreview").className = "direct-preview";
  try {
    await withButtonFeedback("previewDirectBundle", "Проверяю…", async () => {
      const raw = String($("directBundle").value || "").trim();
      const module = await import(chrome.runtime.getURL("protocol/bb2d1-bundle.js"));
      const parsed = await module.decodeBundle(raw, { now: Date.now() });
      directBundlePreview = parsed;
      $("directPreview").textContent = `IP: ${parsed.host}\nПорт: ${parsed.port}\nFingerprint: ${parsed.server_fingerprint}\nInstance: ${parsed.instance_id}\nДействует до: ${parsed.expires_at}`;
      $("directPreview").className = "direct-preview ok";
      $("directIdentityConfirm").disabled = false;
      if (!$("directNewName").value.trim()) $("directNewName").value = `Direct ${parsed.host}`;
      setStatus("Bundle криптографически и структурно проверен. Сверь IP/port/fingerprint и поставь подтверждение.", "success");
    }, "Bundle проверен ✓");
  } catch (error) {
    $("directPreview").textContent = `Bundle отклонён: ${error.code || error.message}`;
    $("directPreview").className = "direct-preview warning";
    setStatus(`Direct bundle отклонён: ${error.code || error.message}`, "error");
  }
});

$("pairDirectProfile").addEventListener("click", async () => {
  if (!directBundlePreview || !$("directIdentityConfirm").checked) return setStatus("Сначала проверь и явно подтверди server identity.", "error");
  try {
    await withButtonFeedback("pairDirectProfile", "Pairing…", async () => {
      await requestDirectHostPermission(directBundlePreview);
      const response = await request("BB2_DIRECT_PAIR", { bundle: directBundlePreview, name: $("directNewName").value }, 30000);
      if (!response.ok) throw Object.assign(new Error(response.error), { code: response.code || "DIRECT_PAIR_FAILED" });
      directBundlePreview = null;
      $("directBundle").value = "";
      $("directIdentityConfirm").checked = false;
      $("directIdentityConfirm").disabled = true;
      $("pairDirectProfile").disabled = true;
      $("directPreview").textContent = "Pairing завершён; server signature подтверждена.";
      $("directPreview").className = "direct-preview ok";
      await loadState({ loadCatalog: false });
      $("directProfile").value = response.profile.profile_id;
      renderDirectProfiles();
      setStatus("Direct-профиль создан и server identity подтверждена подписанным status.", "success");
    }, "Direct подключён ✓");
  } catch (error) {
    await loadState({ loadCatalog: false }).catch(() => null);
    if (error.code !== "DIRECT_PAIRING_REJECTED") {
      directBundlePreview = null;
      $("directBundle").value = "";
      $("directIdentityConfirm").checked = false;
      $("directIdentityConfirm").disabled = true;
      $("pairDirectProfile").disabled = true;
    }
    setStatus(`Direct pairing не завершён: ${error.message}`, "error");
  }
});

$("directProfile").addEventListener("change", renderDirectProfiles);

async function directRemoteAction(type, loading, done) {
  const profile = selectedDirectProfile();
  if (!profile) throw new Error("Direct-профиль не выбран.");
  await requestDirectHostPermission(profile);
  const response = await request(type, { profile_id: profile.profile_id }, 20000);
  if (!response.ok) throw Object.assign(new Error(response.error), { code: response.code });
  await loadState({ loadCatalog: false });
  $("directProfile").value = profile.profile_id;
  renderDirectProfiles();
  setStatus(done, "success");
  return response;
}

$("directStatus").addEventListener("click", async () => {
  try { await withButtonFeedback("directStatus", "Проверяю…", () => directRemoteAction("BB2_DIRECT_STATUS", "", "Signed status подтверждён."), "Статус ✓"); }
  catch (error) { await loadState({ loadCatalog: false }).catch(() => null); setStatus(error.message, "error"); }
});

$("directConnect").addEventListener("click", async () => {
  try { await withButtonFeedback("directConnect", "Подключаю…", () => directRemoteAction("BB2_DIRECT_CONNECT", "", "Direct-профиль подключён после signed status."), "Подключено ✓"); }
  catch (error) { await loadState({ loadCatalog: false }).catch(() => null); setStatus(error.message, "error"); }
});

$("directDisconnect").addEventListener("click", async () => {
  const profile = selectedDirectProfile();
  if (!profile) return setStatus("Direct-профиль не выбран.", "error");
  try {
    await withButtonFeedback("directDisconnect", "Отключаю…", async () => {
      const response = await request("BB2_DIRECT_DISCONNECT", { profile_id: profile.profile_id });
      if (!response.ok) throw new Error(response.error);
      await loadState({ loadCatalog: false });
      $("directProfile").value = profile.profile_id;
      renderDirectProfiles();
      setStatus("Direct-профиль отключён локально. Устройство на сервере не отозвано.", "success");
    }, "Отключено ✓");
  } catch (error) { setStatus(error.message, "error"); }
});

$("directRenameButton").addEventListener("click", async () => {
  const profile = selectedDirectProfile();
  if (!profile) return setStatus("Direct-профиль не выбран.", "error");
  try {
    const response = await request("BB2_DIRECT_RENAME", { profile_id: profile.profile_id, name: $("directRename").value });
    if (!response.ok) throw new Error(response.error);
    await loadState({ loadCatalog: false });
    $("directProfile").value = profile.profile_id;
    renderDirectProfiles();
    setStatus("Direct-профиль переименован.", "success");
  } catch (error) { setStatus(error.message, "error"); }
});

$("directRevoke").addEventListener("click", async () => {
  const profile = selectedDirectProfile();
  if (!profile) return setStatus("Direct-профиль не выбран.", "error");
  if (!confirm(`Отозвать устройство ${profile.name} на сервере? После этого профиль нельзя подключить без нового pairing.`)) return;
  try { await withButtonFeedback("directRevoke", "Отзываю…", () => directRemoteAction("BB2_DIRECT_REVOKE", "", "Устройство отозвано на сервере."), "Отозвано ✓"); }
  catch (error) { await loadState({ loadCatalog: false }).catch(() => null); setStatus(error.message, "error"); }
});

$("directDelete").addEventListener("click", async () => {
  const profile = selectedDirectProfile();
  if (!profile) return setStatus("Direct-профиль не выбран.", "error");
  const active = profile.device_status === "ACTIVE";
  const text = active
    ? `Устройство ${profile.name} всё ещё ACTIVE на сервере. Удалить только локальный профиль и private key БЕЗ revoke?`
    : `Удалить локальный Direct-профиль ${profile.name} и его private key?`;
  if (!confirm(text)) return;
  try {
    const response = await request("BB2_DIRECT_DELETE", { profile_id: profile.profile_id, force: active });
    if (!response.ok) throw new Error(response.error);
    await loadState({ loadCatalog: false });
    setStatus(active ? "Локальный профиль удалён без revoke, как явно подтверждено." : "Direct-профиль и локальный private key удалены.", "success");
  } catch (error) { setStatus(error.message, "error"); }
});
