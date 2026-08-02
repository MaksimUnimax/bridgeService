# BB2 Direct — статус ранов

Общее количество основных ранов: **19**.

| Ран | Назначение | Статус |
|---|---|---|
| BB2-DIRECT-00 | Read-only инвентаризация действующего Bridge и сети | ACCEPTED / PASS |
| BB2-DIRECT-01 | Архитектурный, продуктовый и совместимый контракт | ACCEPTED / PASS |
| BB2-DIRECT-02 | Изолированный source baseline | ACCEPTED / PASS |
| BB2-DIRECT-03 | Минимальная новая служба на localhost | ACCEPTED / PASS |
| BB2-DIRECT-04 | Публичный bind и внешняя достижимость | ACCEPTED / PASS |
| BB2-DIRECT-05 | Instance identity и серверная ключевая пара | ACCEPTED / PASS |
| BB2-DIRECT-06 | Одноразовое pairing | ACCEPTED / PASS |
| BB2-DIRECT-07 | Защищённый прикладной протокол | ACCEPTED / PASS |
| BB2-DIRECT-08 | Совместимый task/report API | ACCEPTED / PASS |
| BB2-DIRECT-09 | Durable jobs и восстановление | ACCEPTED / PASS |
| BB2-DIRECT-10 | Connection bundle и CLI output | ACCEPTED / PASS |
| BB2-DIRECT-11 | Профили серверов в расширении | ACCEPTED / PASS |
| BB2-DIRECT-12 | Direct transport adapter расширения | NOT STARTED |
| BB2-DIRECT-13 | Изоляция диалогов и нескольких серверов | NOT STARTED |
| BB2-DIRECT-14 | Автоматическое переподключение | NOT STARTED |
| BB2-DIRECT-15 | Восстановление после перезапуска | NOT STARTED |
| BB2-DIRECT-16 | Установщик и GitHub package | NOT STARTED |
| BB2-DIRECT-17 | Security и failure test pack | NOT STARTED |
| BB2-DIRECT-18 | Параллельная E2E-приёмка и release | NOT STARTED |

## Принятые markers

```text
BB2_DIRECT_00_READ_ONLY_COMPLETE
BB2_DIRECT_01_COMPLETE
BB2_DIRECT_02_COMPLETE
BB2_DIRECT_03_COMPLETE
BB2_DIRECT_04_COMPLETE
BB2_DIRECT_05_COMPLETE
BB2_DIRECT_06_COMPLETE
BB2_DIRECT_07_COMPLETE
BB2_DIRECT_08_COMPLETE
BB2_DIRECT_09_COMPLETE
BB2_DIRECT_10_COMPLETE
BB2_DIRECT_11_COMPLETE
```

## Правила перехода

- Раны выполняются строго по порядку.
- Одновременно выполняется только один основной ран.
- Основные раны не дробятся и не переименовываются.
- После `PASS` обновляются этот файл и `WORKLOG.md`.
- Единичные defects исправляются под тем же technical ID без создания `FIX1/FIX2/FIX3`.
- Необязательные улучшения записываются как `DEFERRED` и не создают новые раны.

Следующий ран: `BB2-DIRECT-12` — Direct extension transport.

## BB2-DIRECT-11

`BB2-DIRECT-11 = ACCEPTED / PASS`.

ChatGPT-owned `BB2-DIRECT-11-EXT` опубликован от принятой server/lifecycle boundary `63be0af894fe27252ace7fa6eb7480b624df1be4`. Extension implementation commit: `650d5dab847dec4e3d72e9f9a3e70190f693b65b`; evidence commit: `58cc89c4cb14afaae552b64870c23b23ffc26e73`. Implementation diff содержит только `extension/**`; server/runtime/installer не менялись.

Extension `2.0.0.21`, settings schema `5`, реализует отдельные Direct profiles: strict BB2D1 paste/preview, explicit identity confirmation, one-time pairing, отдельный P-256 device-key vault, signed `BB2D-L1` status/connect/revoke, local disconnect/rename/delete, fail-closed identity-change warning, multiple independent Direct profiles, migration `4→5` и backup metadata без Direct private keys. Legacy profile/token/binding behavior сохранён и не смешивается с Direct.

Final local regression: `123/123 PASS`. Chromium `144.0.7559.96` подтвердил real secure-context Web Crypto, unpacked MV3 worker, modular content-script runtime и popup/package runtime. Managed Chromium policy после acceptance восстановлена byte-for-byte к SHA-256 `3b740260e337305aaef268e6c63af8fa2796057ce46f43df5ae5a3949e085e86`.

Authoritative extension package: `business-bridge-chatgpt-extension-v2.0.0.21-run11.zip`, 34 runtime members, SHA-256 `b9cda4ddffcda3909be7026ada8fd813b0a0faa4c333617852b390da286ed34b`; ZIP integrity, unpack byte equality, packaged JS syntax and unpacked Chromium load PASS.

Direct task/report transport намеренно не реализован в Run11 и остаётся scope `BB2-DIRECT-12-EXT`.

Marker: `BB2_DIRECT_11_COMPLETE`.

Следующий ран: `BB2-DIRECT-12` — Direct extension transport, owner ChatGPT.

## BB2-DIRECT-10

`BB2-DIRECT-10 = ACCEPTED / PASS`.

Server step `BB2-DIRECT-10-SRV` принят после corrective attempts 5–7. Финальная опубликованная server boundary: test-oracle commit `84dad3d7f1b7b47cea034491353d6998eda62eca` и attempt-7 evidence commit `80f5725b5acf092337c6f23ea3ed73637cd6a567`; runtime source после `8e128ee252c358aac2da7d8c0cea79ba1686b1e6` не менялся. Direct `0.9.0/schema 5` генерирует strict one-line `BB2D1` bundle; accepted deterministic wheel SHA-256 `50fefc54cf102e1081523dd548fb4c9709a559b50364760791d8eb8097ca21d2`. Final server acceptance: 62/62 gates PASS, production pairing first use `201`, reuse `403`, synthetic cleanup PASS, Direct stable and Legacy unchanged.

ChatGPT-owned `BB2-DIRECT-10-EXT` добавил pure browser parser `extension/protocol/bb2d1-bundle.js`, shared-vector/contract browser harnesses, Node regression and parser documentation. Parser validates BB2D1 framing/version, checksum, canonical JSON/base64url, expiry/TTL, endpoint/IDs, P-256 SPKI and exact fingerprint fail-closed; он не хранит bundle и не реализует profile/pairing/transport lifecycle будущих ранов. Node PASS; Chromium `144.0.7559.96` secure-context acceptance: 6/6 runs, 38/38 negative contract cases per run, real `globalThis.crypto.subtle`, P-384/RSA rejection PASS. Evidence: `docs/development/evidence/BB2-DIRECT-10-EXT_CHATGPT_EVIDENCE.md`.

Server/Legacy runtime не изменялся extension step. `main` не изменён.

Marker: `BB2_DIRECT_10_COMPLETE`.

Следующий ран: `BB2-DIRECT-11` — server profiles in extension.

## BB2-DIRECT-09

`BB2-DIRECT-09 = ACCEPTED / PASS`.

Приняты implementation commit `46ed6317b03ba9b84e52042cdd068379d02ad1b7` и server evidence commit `168f80f3f9b3c3dcd27219c5f93aa15a2bb10236`. Direct `0.8.0/schema 5` реализует durable operation ledger, утверждённый ten-state lifecycle, one-winner leases, stale-owner rejection, startup recovery, `RUNNING→UNKNOWN` без blind retry, internal proof-gated reconciliation, cancellation, expiry и immutable durable reports.

Попытка 2 выявила production permission defect. Corrective attempt 3 добавил complete no-follow staging inventory, safe ownership/modes, unsafe type/hardlink/escape rejection, service-user imports и staged identity verification до activation. Source, protocol, three-build wheel, installed-wheel, rollback, production activation и production restart acceptance прошли.

Final Direct: active/running, `NRestarts=0`, health 200, version `0.8.0`, schema `5`, listener `78.17.68.165:18100`, identity/service user/group/system Python unchanged. Legacy Bridge остался неизменным и не перезапускался.

Independent audit: `docs/development/evidence/BB2-DIRECT-09_CHATGPT_AUDIT.md`.

Governance integrity check: `WORKLOG.md` сохранён полностью; исторические записи не удалены.

Marker: `BB2_DIRECT_09_COMPLETE`.

Следующий ран: `BB2-DIRECT-10`.

## BB2-DIRECT-08

`BB2-DIRECT-08 = ACCEPTED / PASS`.

Приняты implementation commit `ba9614dcd722fd77bf118f78427737f85bed2f6c` и server evidence commit `92f622cbda5103c918af430b32c49f9d7762b44a`. Direct `0.7.0/schema 4` реализует protected create/status/cancel/report, immutable operation ID, canonical idempotency, deterministic payload conflict и repeatable reports. Source, installed-wheel, rollback и production acceptance прошли; package mutation и Direct restart не потребовались.

Независимая ChatGPT-проверка Chromium `144.0.7559.96` выполнила 6/6 PASS с реальным `globalThis.crypto.subtle`: 15 опубликованных canonical/AAD/domain checks, ECDSA P-256, ECDH P-256, HKDF-SHA-256, AES-256-GCM и tamper rejection. Evidence: `docs/development/evidence/BB2-DIRECT-08_CHATGPT_CHROMIUM_EVIDENCE.md`.

Legacy Bridge остался неизменным и не перезапускался.

Marker: `BB2_DIRECT_08_COMPLETE`.

Следующий ран: `BB2-DIRECT-09`.

## BB2-DIRECT-07

`BB2-DIRECT-07 = ACCEPTED / PASS`. FIX2 corrected the proven Web Crypto GCM framing defect and browser byte-transcript issues. Direct 0.6.0/schema 3 passed source, wheel, staging, installed-runtime, real Chrome and production checks.

Marker: `BB2_DIRECT_07_COMPLETE`.

Следующий ран: `BB2-DIRECT-08`.

## BB2-DIRECT-05-FIX7

`BB2-DIRECT-05 = ACCEPTED / PASS`. Marker: `BB2_DIRECT_05_COMPLETE`.

FIX7 завершил permission correction, nested identity metadata migration, exact-wheel deployment, one controlled Direct restart sequence, public bootstrap evidence, rollback proof and legacy safety checks. Следующий ран остаётся исторически зафиксирован как `BB2-DIRECT-06`.

## BB2-DIRECT-06-FIX1

`BB2-DIRECT-06 = ACCEPTED / PASS`. Реализованы одноразовые pairing sessions, TTL 300–600 s, scrypt verifier/salt без plaintext code, пять попыток, per-source/global limits, durable device identity, revoke и redacted audit. Schema 1→2 мигрирована атомарно с bounded lock retry. Exact wheel 0.5.0 установлен только в Direct; controlled restart завершился `active/running`, `NRestarts=0`, public health 200. Identity и legacy Bridge неизменны. Полная redacted evidence: `docs/development/evidence/BB2-DIRECT-06_ACCEPTANCE_EVIDENCE.md`.

Marker: `BB2_DIRECT_06_COMPLETE`.
