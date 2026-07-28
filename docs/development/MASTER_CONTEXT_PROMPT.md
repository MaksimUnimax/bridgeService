# MASTER CONTEXT PROMPT — Business Bridge 2 Direct Connection

Используй этот файл для восстановления контекста проекта.

## Источник правды

- Репозиторий: `https://github.com/MaksimUnimax/bridgeService`
- Рабочая ветка: `development`
- Продовая ветка: `main`
- Статус: `docs/development/RUN_STATUS.md`
- Журнал: `docs/development/WORKLOG.md`
- Политика: `docs/development/REPOSITORY_POLICY.md`

Перед продолжением прочитай эти файлы и текущие отчёты CLI. Считай ран завершённым только при наличии `PASS`, полного прохождения acceptance criteria, ожидаемого `FINAL_MARKER` и отражения результата в GitHub.

## Продукт

```text
ChatGPT
→ Chrome Extension Business Bridge 2
→ прямое защищённое подключение к публичному IP VPS пользователя
→ Business Bridge 2 Direct
→ Codex / CLI пользователя
→ отчёт в тот же диалог ChatGPT
```

Не использовать PowerShell/SSH-туннель в финальной версии, Cloudflare Tunnel, Tailscale, Ngrok, VPN, внешний relay, обязательный домен или сторонний аккаунт. У пользователя должен быть Linux VPS с публичным IPv4 и доступным входящим TCP-портом.

## Рабочий reference

- сервер: `78.17.68.165`;
- служба: `business-bridge-2.service`;
- каталог: `/opt/business-bridge-2`;
- процесс: `python3 -m app.main`;
- listen: `127.0.0.1:18083`;
- health: `GET /v2/health`;
- база: `/opt/business-bridge-2/state/bridge.sqlite3`.

Действующий Bridge запрещено изменять, перезапускать, останавливать, обновлять, переносить, удалять или использовать его secrets/DB/state в новой версии.

## Новая изолированная версия

- `/opt/business-bridge-2-direct`;
- `/etc/business-bridge-2-direct`;
- `/var/lib/business-bridge-2-direct`;
- `/var/log/business-bridge-2-direct`;
- `business-bridge-2-direct.service`;
- пользователь `business-bridge-direct`;
- первичный порт `18100`;
- отдельные DB, keys, identity, state, logs и installer.

## Дисциплина

Существует ровно 19 основных ранов `BB2-DIRECT-00` — `BB2-DIRECT-18`. Выполняй строго по порядку. Выдавай CLI ровно один основной ран. Не дроби, не добавляй, не переименовывай и не повторяй принятые раны. Необязательное записывай в `DEFERRED`.

При `FAILED/BLOCKED` допустим максимум один `BB2-DIRECT-XX-FIX1`, исправляющий только доказанный блокер. После повторного провала остановись и сообщи пользователю точную причину; не создавай цикл `FIX2/FIX3`.

После каждого принятого рана обязательно обновить `RUN_STATUS.md`, `WORKLOG.md`, затронутую документацию и test evidence. Секреты не публиковать даже временно: публичная Git-история не гарантирует полного удаления данных.

## Раны

### BB2-DIRECT-00 — Read-only инвентаризация

Статус: `ACCEPTED / PASS`.

Результат: рабочий Bridge и сеть зафиксированы, выбраны изолированные пути и порт. Marker: `BB2_DIRECT_00_READ_ONLY_COMPLETE`.

### BB2-DIRECT-01 — Продуктовый, архитектурный и совместимый контракт

Создать полное описание продукта, ТЗ, roadmap, архитектуру, compatibility contract, API matrix, security model, acceptance matrix, rollback plan и ADR по direct transport, прикладной криптографии, pairing/device identity. Обновить master context. Marker: `BB2_DIRECT_01_COMPLETE`.

### BB2-DIRECT-02 — Изолированный source baseline

Создать отдельную кодовую основу новой серверной версии, package identity, конфигурационные defaults, отдельный runtime environment, baseline tests и file manifest. Не копировать рабочие secrets, DB или state. Marker: `BB2_DIRECT_02_COMPLETE`.

### BB2-DIRECT-03 — Минимальная новая служба

Создать dedicated user, изолированные каталоги, отдельную DB и systemd unit. Запустить на localhost и отдельном порту. Реализовать `/v2/health`, `/v2/version`, `/v2/diagnostics/public`. Marker: `BB2_DIRECT_03_COMPLETE`.

### BB2-DIRECT-04 — Публичный bind и достижимость

Выбрать реальный bind, открыть только порт новой версии, проверить внешний TCP/HTTP-доступ, provider firewall/security group, timeouts, size и concurrency limits. Старый Bridge не публиковать. Marker: `BB2_DIRECT_04_COMPLETE`.

### BB2-DIRECT-05 — Instance identity

Реализовать `instance_id`, серверную keypair, fingerprint, безопасное хранение private key, bootstrap endpoint, rotation metadata и стабильность identity после restart. Marker: `BB2_DIRECT_05_COMPLETE`.

### BB2-DIRECT-06 — Одноразовое pairing

Реализовать pairing session, одноразовый код, TTL, attempt/rate limits, invalidation, extension device identity, revoke и безопасный audit. Marker: `BB2_DIRECT_06_COMPLETE`.

### BB2-DIRECT-07 — Защищённый прикладной протокол

Реализовать browser/server-compatible key agreement/derivation, authenticated encryption, signatures, fingerprint validation, nonce, timestamp, expiry, request ID, sequence и replay protection. Prompt/report не должны идти plaintext. Marker: `BB2_DIRECT_07_COMPLETE`.

### BB2-DIRECT-08 — Совместимый task/report API

Перенести создание, статус, отмену и отчёт задания; operation ID, idempotency, timeout и size limits. Сопоставить с reference API. Marker: `BB2_DIRECT_08_COMPLETE`.

### BB2-DIRECT-09 — Durable jobs и recovery

Реализовать durable ledger, состояния jobs, сохранение reports, startup recovery, ambiguous state и reconciliation без повторного запуска принятой операции. Marker: `BB2_DIRECT_09_COMPLETE`.

### BB2-DIRECT-10 — Connection bundle

CLI выдаёт один versioned bundle с IP, port, instance identity/fingerprint, pairing session/code, expiry и checksum. Постоянных private secrets в bundle нет. Marker: `BB2_DIRECT_10_COMPLETE`.

### BB2-DIRECT-11 — Профили серверов в расширении

Добавить import bundle, preview fingerprint, pairing, безопасное хранение device identity, rename/status/connect/disconnect/delete/revoke и предупреждение identity change. Legacy profile сохранить. Marker: `BB2_DIRECT_11_COMPLETE`.

### BB2-DIRECT-12 — Direct transport adapter

Реализовать сетевой adapter из extension service worker: host permissions, encrypted envelopes, timeout, polling, cancellation, error mapping и переключение legacy/direct. Доказать реальный task/report flow без PowerShell. Marker: `BB2_DIRECT_12_COMPLETE`.

### BB2-DIRECT-13 — Несколько серверов и изоляция диалогов

Привязать профиль к conversation ID; разделить credentials, sequence, cursors, queues и reports. Проверить два сервера/диалога без смешивания. Marker: `BB2_DIRECT_13_COMPLETE`.

### BB2-DIRECT-14 — Автоматическое переподключение

Реализовать heartbeat, exponential backoff, jitter, service-worker-compatible wake-up, polling fallback, cursor и reconciliation. Краткий обрыв не требует пользователя и не дублирует job. Marker: `BB2_DIRECT_14_COMPLETE`.

### BB2-DIRECT-15 — Восстановление после restart

Восстанавливать server state, browser profile, service-worker state, cursors и pending operations. После перезапуска достаточно кнопки `Подключить`; новый pairing не требуется при прежней identity. Marker: `BB2_DIRECT_15_COMPLETE`.

### BB2-DIRECT-16 — Installer и GitHub package

Создать `install.sh`, `upgrade.sh`, `uninstall.sh`, проверки OS/architecture/port/checksum, user/directories/systemd, identity, self-test, bundle output, rollback и clean-install evidence. Marker: `BB2_DIRECT_16_COMPLETE`.

### BB2-DIRECT-17 — Security и failure tests

Проверить wrong/expired/reused pairing, brute force, wrong fingerprint, MITM simulation, modified ciphertext, wrong signature, replay, stale timestamp, nonce/sequence violations, oversized/slow/concurrent requests, restart/disconnect/duplicates/revoke/cross-profile isolation/log redaction/rollback. Marker: `BB2_DIRECT_17_COMPLETE`.

### BB2-DIRECT-18 — E2E и production release

Выполнить clean install, bundle, pairing, conversation binding, реальный task/report, autoreconnect, server/browser restart, connect button, два профиля, revoke, legacy fallback, release package и extension ZIP. Подготовить чистую `main`, checksums, user guide и release notes. Итог: `READY_FOR_USER_ACCEPTANCE`. Marker: `BB2_DIRECT_18_COMPLETE`.

## Текущее состояние

```text
BB2-DIRECT-00: ACCEPTED / PASS
BB2-DIRECT-01: NEXT
BB2-DIRECT-02..18: NOT STARTED
```

## Контракт BB2-DIRECT-01

Сервер и VPS принадлежат клиенту; relay/control plane разработчика отсутствует, публичный IPv4 обязателен, домен не обязателен, сторонний tunnel не используется. CLI выдаёт один versioned connection bundle с одноразовыми pairing-данными; bundle не содержит постоянный private key и не является бессрочным credential. Sensitive payload защищается application-layer envelope; HTTP не считается защитой. Pairing одноразовое, TTL 5–10 минут, с attempt/rate limits, отдельной device identity и revoke. Серверы изолируются профилями и conversation ID. Краткий обрыв восстанавливается автоматически, после restart достаточно «Подключить». Legacy сохраняется до полной приёмки, Direct не использует рабочие DB/secrets/state/logs.

Изолированные Direct-ресурсы: `/opt/business-bridge-2-direct`, `/etc/business-bridge-2-direct`, `/etc/business-bridge-2-direct/secrets`, `/var/lib/business-bridge-2-direct`, `/var/log/business-bridge-2-direct`, `business-bridge-2-direct.service`, user `business-bridge-direct`, initial port `18100`, first-station IPv4 `78.17.68.165`; bind утверждается в BB2-DIRECT-04. Baseline cryptography: ECDH/ECDSA P-256, HKDF-SHA-256, AES-256-GCM, SHA-256, nonce/timestamp/expiry/sequence/request ID/replay ledger.

Раны 00–18 выполняются строго по порядку, основные раны не дробятся; после FAILED/BLOCKED допускается максимум один FIX1, циклы запрещены. Разработка отражается в `development`, в `main` позднее переносится чистый production release. Текущая точка: `BB2-DIRECT-01 ACCEPTED / PASS`, marker `BB2_DIRECT_01_COMPLETE`, следующий `BB2-DIRECT-02`; runtime Direct и BB2-DIRECT-02 в этом ране не выполняются.

После вставки этого prompt не пересказывай план. Сообщи последний принятый и следующий ран, затем выдай в одном блоке для копирования только полный CLI-prompt следующего рана.
