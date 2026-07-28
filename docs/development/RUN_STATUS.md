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
| BB2-DIRECT-08 | Совместимый task/report API | NOT STARTED |
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
```

## Правила перехода

- Раны выполняются строго по порядку.
- Одновременно выполняется только один основной ран.
- Основные раны не дробятся и не переименовываются.
- После `PASS` обновляются этот файл и `WORKLOG.md`.
- После `FAILED/BLOCKED` допускается один `BB2-DIRECT-XX-FIX1` только для доказанного блокера.
- Необязательные улучшения записываются как `DEFERRED` и не создают новые раны.

Следующий ран: `BB2-DIRECT-08` — совместимый task/report API; он не выполнялся.

## BB2-DIRECT-07

`BB2-DIRECT-07 = ACCEPTED / PASS`. FIX2 corrected the proven Web Crypto GCM framing defect and browser byte-transcript issues. Direct 0.6.0/schema 3 passed source, wheel, staging, installed-runtime, real Chrome and production checks. BB2-DIRECT-08 was not executed.

Marker: `BB2_DIRECT_07_COMPLETE`.

Следующий ран: `BB2-DIRECT-08`.

## BB2-DIRECT-05-FIX7

`BB2-DIRECT-05 = ACCEPTED / PASS`. Marker: `BB2_DIRECT_05_COMPLETE`.

FIX7 завершил permission correction, nested identity metadata migration, exact-wheel deployment, one controlled Direct restart sequence, public bootstrap evidence, rollback proof and legacy safety checks. Следующий ран: `BB2-DIRECT-06`; он не выполнялся.

## BB2-DIRECT-06-FIX1

`BB2-DIRECT-06 = ACCEPTED / PASS`. Реализованы одноразовые pairing sessions, TTL 300–600 s, scrypt verifier/salt без plaintext code, пять попыток, per-source/global limits, durable device identity, revoke и redacted audit. Schema 1→2 мигрирована атомарно с bounded lock retry. Exact wheel 0.5.0 установлен только в Direct; controlled restart завершился `active/running`, `NRestarts=0`, public health 200. Identity и legacy Bridge неизменны. Полная redacted evidence: `docs/development/evidence/BB2-DIRECT-06_ACCEPTANCE_EVIDENCE.md`.

Marker: `BB2_DIRECT_06_COMPLETE`.
Следующий ран: `BB2-DIRECT-07`; не выполнялся.
