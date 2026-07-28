# Business Bridge 2 Direct Connection — полное техническое задание

## 1. Цели и границы

Цель — дать расширению Chrome прямой защищённый канал к CLI-окружению на VPS клиента при сохранении бизнес-семантики legacy Bridge. В scope входят extension-профили, Direct server, installer, pairing, device identity, versioned connection bundle, application-layer encryption, jobs/reports, reconnect/recovery, multi-server и тесты.

Out of scope: relay/control plane разработчика, SaaS, VPN, tunnel, обязательный домен, обязательный сторонний аккаунт, desktop-программа, изменение legacy Bridge, его DB/secrets/state/logs, реализация в BB2-DIRECT-01 и перенос в `main`.

## 2. Компоненты и ресурсы

Компоненты: ChatGPT web UI; Chrome/Chromium extension; Direct server; Codex/поддерживаемая CLI; systemd; отдельная DB/state/secrets. Плановые пути Direct: `INSTALL_DIR=/opt/business-bridge-2-direct`, `CONFIG_DIR=/etc/business-bridge-2-direct`, `SECRETS_DIR=/etc/business-bridge-2-direct/secrets`, `STATE_DIR=/var/lib/business-bridge-2-direct`, `LOG_DIR=/var/log/business-bridge-2-direct`, service `business-bridge-2-direct.service`, user `business-bridge-direct`, initial port `18100`, first-station IPv4 `78.17.68.165`. Bind выбирается в BB2-DIRECT-04: конкретный интерфейсный адрес или `0.0.0.0:18100`.

## 3. Extension и transport

Extension хранит отдельные профили server identity, fingerprint, device identity, pairing state, cursors и conversation binding. Legacy profile остаётся доступным. Direct transport — одно прямое TCP-соединение через HTTP-compatible carrier; relay отсутствует. Sensitive payload никогда не полагается на plaintext HTTP. Таймауты, size limits, backoff, jitter и ошибки должны быть детерминированно отображены в UI.

## 4. Server API и бизнес-механика

API обязан сохранить создание задания, operation ID, idempotency, статусы, отмену, timeout, получение и повторное получение отчёта. Конкретные endpoint’ы legacy до source baseline имеют статус `NEEDS_SOURCE_CONFIRMATION`; этот документ не выдумывает их. Целевой API будет зафиксирован в BB2-DIRECT-08 на основании реального baseline.

Jobs имеют durable lifecycle и request ID; reports сохраняются до политики retention. Повтор запроса отчёта не повторяет выполнение. Ambiguous state после сбоя проходит reconciliation, а не безусловный повтор запуска.

## 5. Pairing, identity и bundle

Каждая установка расширения получает отдельную device identity. Сервер имеет стабильную instance identity и fingerprint. Pairing code одноразовый, TTL 5–10 минут, с лимитами попыток и rate limit; code не является постоянным API key. Bundle versioned, выдаётся CLI, содержит адрес/порт, server identity/fingerprint, pairing session и одноразовые данные с expiry/checksum. Постоянный private key в bundle не помещается; bundle не является бессрочным credential. Revoke инвалидирует device/session; повторное pairing требуется при отзыве или смене identity.

## 6. Security requirements

Baseline: ECDH P-256, ECDSA P-256, HKDF-SHA-256, AES-256-GCM, SHA-256, nonce, timestamp, expiry, sequence, request ID и replay ledger. Envelope versioned, authenticated и подписан; fingerprint проверяется отдельно и не заменяет шифрование. Реализация и test vectors — BB2-DIRECT-07; threat model — [SECURITY_MODEL](../architecture/SECURITY_MODEL.md).

## 7. Runtime, storage, permissions и logs

Runner запускает только разрешённые CLI-операции с минимальными правами и отдельным пользователем. DB, secrets, state и logs Direct не пересекаются с legacy. Секреты хранятся с ограниченными правами; логи редактируют payload, credentials и cookies. Listener ограничивает размер, concurrency, скорость и время обработки; DoS считается эксплуатационным риском.

## 8. Installation, update, uninstall

До BB2-DIRECT-16 install-команда не публикуется. Installer проверит Linux/архитектуру/systemd/порт, создаст только Direct paths и user, установит unit, выполнит self-test и выдаст bundle. Upgrade атомарен с backup/rollback; uninstall останавливает только Direct, сохраняет или явно архивирует Direct backup по выбору пользователя и не трогает legacy.

## 9. Reconnect и restart recovery

Краткий обрыв восстанавливается автоматически heartbeat/backoff/polling/cursors без дублирования job. После restart server state и browser profile восстанавливаются; пользователь нажимает «Подключить», новое pairing не требуется при прежней identity.

## 10. Testing, acceptance и rollback

Требуются unit/protocol vectors, API compatibility, pairing abuse, replay/MITM/ciphertext/signature, size/timeout/DoS, restart, duplicate, revoke, two-server/two-conversation и E2E tests. При сбое Direct отключается отдельно, extension возвращается к legacy profile; legacy остаётся fallback до BB2-DIRECT-18. Полная матрица — [ACCEPTANCE_MATRIX](../architecture/ACCEPTANCE_MATRIX.md).

## 11. Deliverables и Definition of Done

Deliverables: исходники extension/server/installer, тесты, migration-free Direct state, user guide, bundle flow, release evidence и документация. DoD: все 19 ранов приняты строго по порядку, Direct E2E доказан, legacy не изменён, security/failure tests PASS, чистый production release подготовлен в `main` только после принятия BB2-DIRECT-18. Для текущего рана DoD ограничен документационным контрактом; runtime не создаётся.
