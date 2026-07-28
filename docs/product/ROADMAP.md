# BB2 Direct — roadmap 19 ранов

Основные раны выполняются строго по порядку, одновременно только один, без дробления. Corrective continuation не создаёт новый основной ран и обязана повторно проверить все acceptance criteria исходного рана.

| ID | Цель и полный scope | Acceptance | Final marker |
|---|---|---|---|
| BB2-DIRECT-00 | Read-only инвентаризация legacy, сети, путей и ограничений | Legacy зафиксирован, health 200, Direct не затронут | `BB2_DIRECT_00_READ_ONLY_COMPLETE` |
| BB2-DIRECT-01 | Продуктовый, архитектурный и совместимый контракт, security, ADR и матрицы | Документы согласованы, checks PASS, commit в development | `BB2_DIRECT_01_COMPLETE` |
| BB2-DIRECT-02 | Source baseline, package identity, defaults, isolated environment, baseline tests и manifest | Кодовая основа изолирована, secrets/DB/state не копируются | `BB2_DIRECT_02_COMPLETE` |
| BB2-DIRECT-03 | Dedicated user, paths, DB, systemd, localhost health/version/diagnostics | Новая служба работает локально, legacy неизменён | `BB2_DIRECT_03_COMPLETE` |
| BB2-DIRECT-04 | Реальный bind, public reachability, firewall/security group, limits | Внешний TCP/HTTP доступ к Direct доказан, legacy не опубликован | `BB2_DIRECT_04_COMPLETE` |
| BB2-DIRECT-05 | Instance identity, keypair, fingerprint, bootstrap, rotation metadata | Identity стабильна после restart и безопасно хранится | `BB2_DIRECT_05_COMPLETE` |
| BB2-DIRECT-06 | Одноразовое pairing, TTL, limits, invalidation, device identity, revoke, audit | Reuse/expiry/brute-force/revoke тесты PASS | `BB2_DIRECT_06_COMPLETE` |
| BB2-DIRECT-07 | Browser/server crypto, envelope, signatures, AEAD, replay controls и vectors | Prompt/report не plaintext; vectors и abuse tests PASS | `BB2_DIRECT_07_COMPLETE` |
| BB2-DIRECT-08 | Совместимый task/report API, IDs, idempotency, timeout, sizes | Реальная семантика legacy доказана по source baseline | `BB2_DIRECT_08_COMPLETE` |
| BB2-DIRECT-09 | Durable jobs, reports, startup recovery, ambiguous state, reconciliation | Restart/duplicate не повторяют принятую операцию | `BB2_DIRECT_09_COMPLETE` |
| BB2-DIRECT-10 | Versioned connection bundle и CLI output | Bundle импортируется, expiry/checksum/fingerprint проверяются | `BB2_DIRECT_10_COMPLETE` |
| BB2-DIRECT-11 | Extension profiles, import, pairing, secure storage, status и legacy profile | Профильные операции и identity warning PASS | `BB2_DIRECT_11_COMPLETE` |
| BB2-DIRECT-12 | Direct adapter, permissions, envelopes, timeout, polling, cancellation, mapping | Реальный task/report flow без tunnel PASS | `BB2_DIRECT_12_COMPLETE` |
| BB2-DIRECT-13 | Несколько серверов, conversation binding и изоляция credentials/queues/reports | Два сервера и диалога не смешиваются | `BB2_DIRECT_13_COMPLETE` |
| BB2-DIRECT-14 | Heartbeat, backoff/jitter, worker wake-up, cursor reconciliation | Краткий обрыв сам восстанавливается без duplicate job | `BB2_DIRECT_14_COMPLETE` |
| BB2-DIRECT-15 | Server/browser/service-worker restart recovery и connect button | При прежней identity нового pairing нет | `BB2_DIRECT_15_COMPLETE` |
| BB2-DIRECT-16 | Installer/upgrade/uninstall, checks, self-test, bundle, rollback, package | Clean install/upgrade/uninstall evidence PASS | `BB2_DIRECT_16_COMPLETE` |
| BB2-DIRECT-17 | Security/failure tests, abuse, isolation, redaction и rollback | Полный security/failure pack PASS | `BB2_DIRECT_17_COMPLETE` |
| BB2-DIRECT-18 | E2E, release, checksums, extension ZIP, guide и clean main | Production release готов к user acceptance | `BB2_DIRECT_18_COMPLETE` |

Текущий подтверждённый результат: `BB2-DIRECT-07 ACCEPTED / PASS`. Direct 0.6.0 имеет отдельную identity, одноразовое pairing и защищённый BB2D-P1 browser/server protocol с реальным Chrome Web Crypto evidence. Task/report API и выполнение пользовательских заданий ещё отсутствуют. Следующий основной ран: `BB2-DIRECT-08`.
