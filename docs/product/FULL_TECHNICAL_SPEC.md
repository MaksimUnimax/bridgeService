# Business Bridge 2 Direct Connection — полное техническое задание

## 1. Цели и границы

Цель — дать расширению Chrome прямой защищённый канал к CLI-окружению на VPS клиента при сохранении бизнес-семантики legacy Bridge. В scope входят extension-профили, Direct server, installer, pairing, device identity, versioned connection bundle, application-layer encryption, jobs/reports, reconnect/recovery, multi-server и тесты.

Out of scope: vendor relay, сторонний relay/control plane разработчика, SaaS, VPN, PowerShell/SSH tunnel, обязательный домен, обязательный сторонний аккаунт, desktop-программа, изменение legacy Bridge, его DB/secrets/state/logs и перенос незавершённой разработки в `main`.

## 2. Компоненты и ресурсы

Компоненты: ChatGPT web UI; Chrome/Chromium extension; Direct server; Codex/поддерживаемая CLI; systemd; отдельная DB/state/secrets. Ресурсы Direct: `INSTALL_DIR=/opt/business-bridge-2-direct`, `CONFIG_DIR=/etc/business-bridge-2-direct`, `SECRETS_DIR=/etc/business-bridge-2-direct/secrets`, `STATE_DIR=/var/lib/business-bridge-2-direct`, `LOG_DIR=/var/log/business-bridge-2-direct`, service `business-bridge-2-direct.service`, user `business-bridge-direct`, port `18100`, IPv4 `78.17.68.165`. BB2-DIRECT-04 принял exact bind `78.17.68.165:18100`; IPv6 listener отсутствует.

## 3. Extension и transport

Extension хранит отдельные профили server identity, fingerprint, device identity, pairing state, cursors и conversation binding. Legacy profile остаётся доступным. Direct transport — прямое подключение через HTTP-compatible carrier; relay отсутствует. Sensitive payload никогда не полагается на plaintext HTTP. Таймауты, size limits, backoff, jitter и ошибки должны быть детерминированно отображены в UI.

BB2-DIRECT-07 принял протокол `BB2D-P1`: paired-device/server ECDSA P-256, ephemeral ECDH P-256, HKDF-SHA-256, directional AES-256-GCM, strict canonical JSON/base64url, nonce, timestamp, expiry, request ID, sequence и replay protection. Browser/server interoperability доказана реальным Chrome Web Crypto. Web Crypto переносит AES-GCM как один `ciphertext||tag` field с 16-byte final tag.

## 4. Server API и бизнес-механика

API сохраняет создание задания, immutable operation ID, canonical-payload idempotency, статусы, отмену, получение и повторное получение отчёта. BB2-DIRECT-08 принял Direct mapping без копирования legacy DB, secrets, state или bearer credentials.

Direct `0.8.0`, SQLite schema `5`, поддерживает `task_create`, `task_status`, `task_cancel` и `task_report` только через `/v2/protocol/tasks` внутри `BB2D-P1`. Эквивалентный повтор operation ID не запускает задание второй раз; тот же operation ID с другим canonical payload возвращает deterministic conflict; повторный запрос готового отчёта возвращает тот же результат.

Ошибки до успешной authentication/decryption возвращаются как strict generic non-sensitive HTTP JSON и не изображают доверенный encrypted response. Прикладные ошибки после успешной authentication/decryption возвращаются только внутри подписанного и зашифрованного status-bound `task_error` envelope.

BB2-DIRECT-09 принял durable operation ledger и состояния `CREATED`, `QUEUED`, `ACCEPTED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`, `UNKNOWN`, `EXPIRED`. Durable transition history, one-winner leases, stale-owner rejection, startup recovery, cancellation, expiry, immutable reports и internal proof-gated reconciliation предотвращают повторное выполнение. Ambiguous `RUNNING` после сбоя становится `UNKNOWN` и никогда автоматически не возвращается в executable state.

Реальный Codex/CLI subprocess runner остаётся за пределами BB2-DIRECT-09. Public reconnect/reconciliation endpoint остаётся scope BB2-DIRECT-14.

## 5. Pairing, identity и bundle

Каждая установка расширения получает отдельную device identity. Сервер имеет стабильную instance identity и fingerprint. Pairing code одноразовый, TTL 5–10 минут, с лимитами попыток и rate limit; code не является постоянным API key. Bundle versioned, выдаётся CLI, содержит адрес/порт, server identity/fingerprint, pairing session и одноразовые данные с expiry/checksum. Постоянный private key в bundle не помещается; bundle не является бессрочным credential. Revoke инвалидирует device/session; повторное pairing требуется при отзыве или смене identity.

BB2-DIRECT-05 и BB2-DIRECT-06 приняли стабильную server identity, bootstrap, one-time pairing, отдельную device identity и revoke. Connection bundle остаётся scope BB2-DIRECT-10.

## 6. Security requirements

Accepted baseline: ECDH P-256, ECDSA P-256, HKDF-SHA-256, AES-256-GCM, SHA-256, nonce, timestamp, expiry, sequence, request ID и replay ledger. Envelope versioned, authenticated и подписан; fingerprint проверяется отдельно и не заменяет шифрование. BB2-DIRECT-07 implementation, real-browser vectors, tamper/replay rejection и plaintext-absence evidence приняты; threat model — [SECURITY_MODEL](../architecture/SECURITY_MODEL.md).

Task/report endpoints работают только внутри `BB2D-P1` protected envelopes. Публичный plaintext fallback, bearer compatibility и секреты в URL/logs запрещены. Pre-auth error может содержать только generic non-sensitive code; task/report application payload и application error доступны только после успешной authentication/decryption внутри protected envelope.

Lease token не возвращается через API и не пишется в logs; в SQLite хранится только SHA-256 hash. Completion требует exact owner/token-hash/attempt. Startup ambiguity не разрешается blind retry. Transition history не содержит task payload или report body.

## 7. Runtime, storage, permissions и logs

Runner запускает только разрешённые CLI-операции с минимальными правами и отдельным пользователем. DB, secrets, state и logs Direct не пересекаются с legacy. Секреты хранятся с ограниченными правами; логи редактируют payload, credentials и cookies. Listener ограничивает размер, concurrency, скорость и время обработки; DoS считается эксплуатационным риском.

Direct SQLite schema `5` хранит runtime metadata, pairing/device state, protocol session/replay metadata, durable operation/task/report state, leases и transition history. Migration `4→5` сохраняет существующие operation/task IDs, canonical hashes и reports.

Production package activation использует Direct-only same-filesystem staging, complete no-follow inventory, rejection unsafe types/hardlinks/escapes, root/service-group ownership and bounded modes, service-user imports and staged identity verification. Systemd unit, Direct identity, service user/group, secrets и system Python не меняются этим механизмом.

## 8. Installation, update, uninstall

До BB2-DIRECT-16 install-команда не публикуется. Installer проверит Linux/архитектуру/systemd/порт, создаст только Direct paths и user, установит unit, выполнит self-test и выдаст bundle. Upgrade атомарен с backup/rollback; uninstall останавливает только Direct, сохраняет или явно архивирует Direct backup по выбору пользователя и не трогает legacy.

## 9. Reconnect и restart recovery

Server-side durable task recovery принято в BB2-DIRECT-09: pending tasks и terminal reports переживают restart, а ambiguous execution становится `UNKNOWN` без blind retry. Public reconnect/cursor API, automatic extension backoff и browser profile recovery остаются ранами BB2-DIRECT-14 и BB2-DIRECT-15.

Краткий обрыв в финальном продукте восстанавливается автоматически heartbeat/backoff/polling/cursors без дублирования job. После restart server state и browser profile восстанавливаются; пользователь нажимает «Подключить», новое pairing не требуется при прежней identity.

## 10. Testing, acceptance и rollback

Требуются unit/protocol vectors, API compatibility, pairing abuse, replay/MITM/ciphertext/signature, size/timeout/DoS, restart, duplicate, revoke, two-server/two-conversation и E2E tests. При сбое Direct отключается отдельно, extension возвращается к legacy profile; legacy остаётся fallback до BB2-DIRECT-18. Полная матрица — [ACCEPTANCE_MATRIX](../architecture/ACCEPTANCE_MATRIX.md).

BB2-DIRECT-08 прошёл source, installed-wheel, isolated rollback и production task/report acceptance. Независимая проверка Chromium выполнила 6/6 запусков с реальным `globalThis.crypto.subtle`, опубликованными canonical/AAD/domain vectors, ECDSA, ECDH, HKDF и AES-256-GCM.

BB2-DIRECT-09 прошёл migration/state-machine/idempotency/lease/recovery/reconciliation tests, three-build reproducible wheel, installed-wheel acceptance, unsafe-staging rollback rehearsal, production service-user pre-activation probes and production restart acceptance. Duplicate execution и blind retry не наблюдались; repeated report сохранил identity/hash; synthetic pending tasks и active leases очищены.

Каждый принятый ран обязан иметь source/wheel/staging/installed и применимые production evidence, Direct-only rollback и неизменность legacy Bridge. Sensitive payload, private keys, pairing codes, traffic keys и production DB не публикуются.

## 11. Deliverables и Definition of Done

Deliverables: исходники extension/server/installer, тесты, migration-managed Direct state, user guide, bundle flow, release evidence и документация. DoD: все 19 ранов приняты строго по порядку, Direct E2E доказан, legacy не изменён, security/failure tests PASS, чистый production release подготовлен в `main` только после принятия BB2-DIRECT-18.

Текущее принятое состояние заканчивается BB2-DIRECT-09: Direct `0.8.0/schema 5`, stable identity, one-time pairing, `BB2D-P1`, compatible task/report API и durable jobs/recovery. Первый непринятый основной ран — BB2-DIRECT-10, connection bundle.
