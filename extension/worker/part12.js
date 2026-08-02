async function migrateCopyButtonProfilesV2() {
  const data = await storageGet([KEYS.COPY_BUTTON_PROFILES, KEYS.COPY_BUTTON_PROFILE]);
  if (data[KEYS.COPY_BUTTON_PROFILES]) {
    const existing = copyButtonProfileCollection(data[KEYS.COPY_BUTTON_PROFILES]);
    await storageSet({
      [KEYS.COPY_BUTTON_PROFILES]: existing,
      [KEYS.COPY_BUTTON_PROFILE]: legacyCompatibleCopyButtonProfile(existing)
    });
    return { migrated: false, custom_profile_count: existing.profiles.length };
  }
  const migrated = copyButtonProfileCollection(data[KEYS.COPY_BUTTON_PROFILE] || null);
  await storageSet({
    [KEYS.COPY_BUTTON_PROFILES]: migrated,
    [KEYS.COPY_BUTTON_PROFILE]: legacyCompatibleCopyButtonProfile(migrated)
  });
  return { migrated: true, custom_profile_count: migrated.profiles.length };
}

async function migrateSettingsSchema() {
  return withStorageLock("settings_schema_migration", async () => {
    const current = await storageGet(KEYS.SETTINGS_SCHEMA);
    const fromVersion = Math.max(0, Number(current[KEYS.SETTINGS_SCHEMA] || 0));
    if (fromVersion === SETTINGS_SCHEMA_VERSION) return { migrated: false, from_version: fromVersion, to_version: SETTINGS_SCHEMA_VERSION };
    if (fromVersion > SETTINGS_SCHEMA_VERSION) throw new Error(`Unsupported future settings schema ${fromVersion}.`);
    const backup = await exportSettingsBackup();
    await storageSet({
      [KEYS.MIGRATION_BACKUP]: {
        created_at: new Date().toISOString(),
        from_version: fromVersion,
        to_version: SETTINGS_SCHEMA_VERSION,
        backup
      }
    });
    if (fromVersion === 0) await migrateLegacySettingsIfPresent();
    const copyProfilesMigration = fromVersion < 4 ? await migrateCopyButtonProfilesV2() : { migrated: false };
    const directProfilesMigration = fromVersion < 5 ? await migrateDirectProfilesV5() : { migrated: false };
    await storageSet({ [KEYS.SETTINGS_SCHEMA]: SETTINGS_SCHEMA_VERSION });
    return {
      migrated: true,
      from_version: fromVersion,
      to_version: SETTINGS_SCHEMA_VERSION,
      profile_count: backup.profile_count,
      copy_button_profiles: copyProfilesMigration,
      direct_profiles: directProfilesMigration
    };
  });
}

async function initializeExtensionStorage(reason = "runtime") {
  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => null);
  }
  const migration = await migrateSettingsSchema();
  await clientId();
  await diagnostic("EXTENSION_STORAGE_READY", {
    reason,
    settings_schema_version: SETTINGS_SCHEMA_VERSION,
    migration
  });
  return migration;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  listRuns().then((runs) => {
    for (const run of runs) {
      if (![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR, BB2Model.RUN_STATUSES.PAUSED, BB2Model.RUN_STATUSES.WAITING_PROMPT].includes(run.status)) {
        schedulePoll(run.run_id, 0);
      }
    }
  }).catch(() => null);
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: BB2Protocol.RECOVERY_ALARM_MINUTES });
  initializeExtensionStorage(`installed:${details?.reason || "unknown"}`).then(() => garbageCollectRuns()).then(() => garbageCollectCredentials()).catch((error) => diagnostic("EXTENSION_INITIALIZATION_FAILED", { reason: "installed", error: error.message }, { level: "error" }));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: BB2Protocol.RECOVERY_ALARM_MINUTES });
  initializeExtensionStorage("browser_startup").then(() => garbageCollectRuns()).then(() => garbageCollectCredentials()).catch((error) => diagnostic("EXTENSION_INITIALIZATION_FAILED", { reason: "startup", error: error.message }, { level: "error" }));
  listRuns().then((runs) => {
    for (const run of runs) {
      if (![BB2Model.RUN_STATUSES.STOPPED, BB2Model.RUN_STATUSES.ERROR, BB2Model.RUN_STATUSES.PAUSED, BB2Model.RUN_STATUSES.WAITING_PROMPT].includes(run.status)) {
        schedulePoll(run.run_id, 1000);
      }
    }
  }).catch(() => null);
});

initializeExtensionStorage("worker_boot").catch((error) => diagnostic("EXTENSION_INITIALIZATION_FAILED", { reason: "worker_boot", error: error.message }, { level: "error" }));
