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
| BB2-DIRECT-09 | Durable jobs и восстановление | NOT STARTED |
| BB2-DIRECT-10 | Connection bundle и CLI output | NOT STARTED |
| BB2-DIRECT-11 | Профили серверов в расширении | NOT STARTED |
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
```

## Правила перехода

- Раны выполняются строго по порядку.
- Одновременно выполняется только один основной ран.
- Основные раны не дробятся и не переименовываются.
- После `PASS` обновляются этот файл и `WORKLOG.md`.
- Единичные defects исправляются под тем же technical ID без создания `FIX1/FIX2/FIX3`.
- Необязательные улучшения записываются как `DEFERRED` и не создают новые раны.

Следующий ран: `BB2-DIRECT-09` — durable jobs and recovery; он не выполнялся.

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
