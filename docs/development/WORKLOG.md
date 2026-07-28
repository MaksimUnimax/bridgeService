# Business Bridge 2 Direct — журнал работ

## 2026-07-28 — BB2-DIRECT-07

FIX2 завершил corrective continuation BB2-DIRECT-07. Первопричина AES interoperability была в wire framing: Web Crypto output `ciphertext||tag` попадал в boundary без единого явного split/join contract; Python AESGCM должен получать combined value ровно один раз. Дополнительно production browser module теперь canonicalizes ECDSA low-S и подписывает raw-byte transcript с nonce ровно один раз. Source/wheel/staging suites: 42 passed + 16 subtests; реальный Google Chrome 147 headless использовал `globalThis.crypto.subtle`, production pairing/handshake/Chrome→server AES/server→Chrome AES дали PASS. Wheel SHA-256 `083db710d7251fc40d84833612f10d00d8725c4aac26335482e3559d04a9ceb0`. Direct 0.6.0/schema 3 развернут, один planned restart, identity сохранена, synthetic devices удалены, legacy Bridge не изменён. Evidence: `docs/development/evidence/BB2-DIRECT-07_FIX2_*`. BB2-DIRECT-08 не выполнялся.

## 2026-07-28 — Инициализация репозитория

### Выполнено

- Подтверждён публичный репозиторий `MaksimUnimax/bridgeService`.
- Создана продовая ветка `main` с базовым `README.md`.
- Создана рабочая ветка `development`.
- Зафиксирована политика репозитория и публичной истории.
- Создан трекер 19 основных ранов.
- Зафиксировано, что рабочая история проекта должна отражаться в GitHub.

### Решение по истории

- Текущая разработка ведётся в `development`.
- В `main` попадают только принятые продовые материалы.
- Перед релизом допускается squash merge и удаление временной ветки.
- Секретные данные не публикуются даже временно, поскольку полное удаление из публичной Git-истории не гарантируется.

---

## BB2-DIRECT-00 — Read-only инвентаризация

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Действующая служба: `business-bridge-2.service`.
- Рабочий каталог: `/opt/business-bridge-2`.
- Процесс: `python3 -m app.main`.
- Runtime: Python `3.10.12`.
- Listen: `127.0.0.1:18083`.
- Health: `GET /v2/health → HTTP 200` до и после проверки.
- Публичный IPv4: `78.17.68.165`.
- Порты `18100–18199` были свободны на момент проверки.
- Выбран первичный порт новой версии `18100`.
- Определены полностью изолированные каталоги и новая systemd-служба.
- Действующий Bridge не изменён и не перезапущен.

### Изолированные ресурсы новой версии

- `/opt/business-bridge-2-direct`;
- `/etc/business-bridge-2-direct`;
- `/var/lib/business-bridge-2-direct`;
- `/var/log/business-bridge-2-direct`;
- `business-bridge-2-direct.service`;
- пользователь `business-bridge-direct`.

### Marker

```text
BB2_DIRECT_00_READ_ONLY_COMPLETE
```

### Следующий ран

`BB2-DIRECT-01` — архитектурный, продуктовый и совместимый контракт.

---

## BB2-DIRECT-01 — продуктовый, архитектурный и совместимый контракт

**Статус:** ACCEPTED / PASS

### Созданные и обновлённые материалы

Созданы product, architecture, security, compatibility, acceptance, rollback и три ADR-документа; обновлены README, master context, run status и этот worklog; добавлено documentation evidence.

### Принятые решения

- Direct — прямое соединение extension с публичным IPv4 VPS клиента без relay/control plane, tunnel или обязательного домена.
- Bundle выдаёт CLI, содержит одноразовые pairing-данные, не содержит постоянный private key.
- Sensitive payload защищается application-layer encryption; legacy остаётся fallback.
- Direct получает отдельные paths/DB/secrets/service/user/port; bind подтверждается в BB2-DIRECT-04.
- Pairing имеет TTL 5–10 минут, single-use, limits, device identity и revoke.

### Проверки и ограничения

Выполнены проверки наличия/непустоты файлов, Markdown-ссылок, placeholder/secret scans, terminology/cross-document consistency, 19-run count, acceptance coverage, SHA-256 и git diff. Runtime, systemd unit, user, порт 18100, firewall, legacy Bridge и BB2-DIRECT-02 не затрагивались. Неподтверждённые legacy endpoint’ы оставлены `NEEDS_SOURCE_CONFIRMATION` до BB2-DIRECT-02/08.

### Marker и следующий ран

`BB2_DIRECT_01_COMPLETE`.

Следующий ран: `BB2-DIRECT-02` — изолированный source baseline.

## BB2-DIRECT-01-FIX1 — controlled acceptance continuation

Документационный follow-up исправил явность product/network/security/API/rollback contract в разрешённых файлах. Runtime Business Bridge 2 Direct не создавался и не запускался; действующий legacy Bridge не изменялся и не перезапускался. Commit SHA финальной публикации будет зафиксирован в evidence после обычного follow-up commit; следующий ран остаётся `BB2-DIRECT-02`.

Marker: `BB2_DIRECT_01_COMPLETE`.

## 2026-07-28 — BB2-DIRECT-02-FIX1 — isolated source baseline

### Контекст и исправление

- Первоначальная попытка BB2-DIRECT-02 была `BLOCKED` с ошибкой `invalid command 'bdist_wheel'`.
- Причина: isolated staging environment не содержал пакет `wheel`, а packaging path вызывал legacy `bdist_wheel`.
- FIX1 ограничен этим blocker: объявлен PEP 517 backend `setuptools.build_meta`, build requirements `setuptools>=65` и `wheel>=0.40`, а toolchain установлен только в Direct staging venv.
- `wheel` импортирован из staging venv; установка и wheel build выполнены через `python -m pip` с `--no-build-isolation` без прямого вызова setup.py.

### Baseline и безопасность

- Создана canonical source tree `server/src/business_bridge_direct/` с distribution `business-bridge-2-direct`.
- Включён только side-effect-free configuration defaults; legacy API, SQLite, secrets, executor subprocesses, scheduler и service activation исключены и документированы.
- Staging установлен атомарно в `/opt/business-bridge-2-direct`; service, user, process, listener, DB и runtime directories не создавались.
- Legacy Bridge оставался healthy, его PID/start time/NRestarts не изменились; legacy source читался только read-only.

### Проверки и публикация

- Repository, staging и final-tree baseline tests: 7 collected, 7 passed, 0 failed, 0 skipped.
- Manifest SHA-256 verification: PASS; source/install hash comparison: PASS.
- Evidence фиксирует resolved toolchain, source inventory, hashes, acceptance criteria и final safety state.
- Commit и remote publication SHA зафиксированы в evidence.

Marker: `BB2_DIRECT_02_COMPLETE`.
Следующий ран: `BB2-DIRECT-03`.

## 2026-07-28 — BB2-DIRECT-03 — isolated localhost service

- Implementation commits: `89575d777a1a02b06ece95c6ed85f0711e6ec786` and lifecycle-test follow-up `e9bee7bb1d8017cd42d480e940bafb6a61a41f61`; both published linearly to `development` with the project-specific deploy key over SSH/443. `main` remained `c426263e6dd00135a0023a0fa08a500273e73e23`.
- Installed `/opt/business-bridge-2-direct` version 0.2.0, config `/etc/business-bridge-2-direct/service.json`, state `/var/lib/business-bridge-2-direct`, log contract `/var/log/business-bridge-2-direct`, empty secrets directory, and unit `business-bridge-2-direct.service`.
- Dedicated system user/group `business-bridge-direct` (UID/GID 995), nologin, locked password, no privileged groups. Listener is exactly `127.0.0.1:18100`; endpoints are GET health, version and public diagnostics only.
- SQLite is owned by the Direct user, mode 0600, `PRAGMA user_version=1`, one `runtime_metadata` table, and schema/service metadata only. No legacy database, state, logs, secrets or venv were reused.
- Repository, staging and final installed tests passed: 13 collected, 13 passed, 0 failed, 0 skipped. Wheel/package metadata and manifest verification passed; systemd-analyze verify passed; installed unit is byte-equivalent to the repository template.
- One controlled Direct SIGKILL restart-policy test was executed. PID changed from 1661755 to 1661953; NRestarts increased from 20 to 24; service recovered active/running with health 200 and persistent DB schema. Legacy before/after remained PID 1619365, start `Mon 2026-07-27 13:16:29 MSK`, NRestarts 0, localhost listener and health 200.
- Two pre-activation Direct staging attempts were rolled back safely; the final deployment remained within Direct scope. No legacy mutation occurred. Evidence is redacted and contains no secrets, tokens, DB rows or full journal.

Marker: `BB2_DIRECT_03_COMPLETE`.
Следующий ран: `BB2-DIRECT-04` — public bind/firewall/external reachability; не выполнялся.

## 2026-07-28 — BB2-DIRECT-04 — bounded public IPv4 listener

- Expected base matched `6ba7db7ae7d299e610d4e7b68f640b9f2bc06314`; `main` remained `c426263e6dd00135a0023a0fa08a500273e73e23`. Implementation commits: `cf16289dd60766f67b7a14c56c6f5839e19dc985`, `b4bd13b`; acceptance commit is recorded in the final evidence update.
- Network inventory found `78.17.68.165/24` locally on `eth0`, source address for the default route and confirmed by two independent IP echo services. Selected exact bind `78.17.68.165:18100`; no NAT inference and no IPv6 listener.
- Backup completed before mutation at `/var/backups/business-bridge-2-direct/BB2-DIRECT-04-20260728T065830Z/`. Host firewall was already permissive (`INPUT ACCEPT`, UFW/firewalld inactive), so mutation was `NONE`; SSH and legacy rules were unchanged.
- Direct was upgraded to 0.3.0 with bounded timeout, size, header, backlog, concurrency and in-memory per-source/global rate limits. SQLite schema remained version 1 with the single runtime metadata table.
- Repository, staging and installed tests: 16 collected, 16 passed, 0 failed, 0 skipped. Wheel metadata is 0.3.0 and source/install hashes match.
- External check-host probes after deployment and restart: TCP 5/5 and HTTP `/v2/health` 5/5 HTTP 200. Legacy external TCP 18083 was 0/5 success. Limit tests covered 400/404/405/413/414/429/431/503 and timeout.
- One successful controlled Direct restart changed PID `1664395` to `1664423`, preserved `NRestarts=0` and restored the public listener. A graceful-shutdown correction was required after the first restart attempt exposed a stop deadlock; no legacy mutation occurred.
- Rollback is Direct-only to the saved 0.2.0 localhost tree/config/unit; firewall inverse is exact rule removal, with no rule added in this run. Limitations: diagnostics/bootstrap only, no identity, pairing, crypto, tasks, reports or production-readiness claim.

Marker: `BB2_DIRECT_04_COMPLETE`.
Следующий ран: `BB2-DIRECT-05`.

## 2026-07-28 — BB2-DIRECT-05 — stable server identity

- Expected base `ff7829f662b5210619e1382c7984310a4e9d37f4` matched; implementation commit `cda5c8bebba0d756507b7eae44cd5b0e04c64762` was published linearly to `development`. Main remained `c426263e6dd00135a0023a0fa08a500273e73e23`.
- Direct is 0.4.0. ECDSA P-256, unencrypted PKCS#8 PEM, canonical SPKI DER, base64url public representation and SHA-256 fingerprint were provisioned once. Instance `73515b73-a4d3-41c7-b143-624ce2a42eb5`, public fingerprint `sha256:b0adfb05bd25e9684279494aa8054191dca70784fab416a29ec699b737111bc4`, generation 1.
- Private key and metadata are Direct-only, root:business-bridge-direct mode 0640; second init returned unchanged; startup validates before binding and never generates identity. `/v2/bootstrap` is deterministic public discovery.
- No pairing, device identity, token, signature envelope, encryption, tasks or reports were added. Repository tests: 18 collected, 18 passed, 0 failed, 0 skipped. Isolated restore preserved identity and production files were unchanged.
- Post-restart external check-host probes: TCP 5/5, health 5/5, bootstrap 5/5; legacy external 18083 0/5. Legacy PID 1619365, start timestamp and NRestarts 0 remained unchanged; firewall mutation NONE.
- Rotation contract is documented; production rotation was not performed.

Marker: `BB2_DIRECT_05_COMPLETE`.
Следующий ран: `BB2-DIRECT-06` — одноразовое pairing; не выполнялся.

## 2026-07-28 — BB2-DIRECT-06-FIX1 — one-time pairing acceptance

- Implementation commit `bbbc63de129f5ff763672d2084bacf0f892de4c5` добавил pairing session state machine, 128-bit one-time code, TTL 300–600 секунд, five-attempt lock, pairing-specific rate limits, separate device public identity, revoke, safe audit и schema 1→2 migration. Code хранится только через scrypt verifier/salt; device private key не принимается.
- Реальная причина предыдущего production restart loop была скрыта generic startup exception; controlled schema migration могла проиграть краткой SQLite lock race. Исправление ограничено Direct startup: bounded retry только `database is locked`; restart policy не ослаблялась.
- Exact wheel `business_bridge_2_direct-0.5.0-py3-none-any.whl`, SHA-256 `b26ea45ff0239449710bfefc872ccdd9f271eec754ec2d48fbd92473cccbaadd5`; metadata/RECORD/ZIP/runtime scan PASS. Full source/wheel/staging/installed suite: 38 passed, 16 subtests passed; compileall, manifest и systemd verify PASS.
- Pre-mutation root-only backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-06-FIX1-pre-20260728T114412Z/`; dirty repository snapshot, Direct tree/config/unit, SQLite backup API и identity/private-key pair сохранены без вывода содержимого.
- Direct 0.5.0 deployed only to public `78.17.68.165:18100`; migration produced `user_version=2`, integrity `ok`, final service active/running with `NRestarts=0`. Valid/reuse/expiry/wrong/attempt/rate/malformed/GET/revoke/restart persistence acceptance passed. TCP and HTTP probes 5/5.
- Server instance ID, fingerprint, rotation generation and private key metadata remained unchanged. Legacy PID `1619365`, start time, NRestarts `0`, localhost listener `127.0.0.1:18083` and health remained unchanged. No legacy service or state was mutated.
- Redacted evidence: `docs/development/evidence/BB2-DIRECT-06_ACCEPTANCE_EVIDENCE.md` and `.json`. Marker: `BB2_DIRECT_06_COMPLETE`.

Следующий ран: `BB2-DIRECT-07` — не выполнялся.

## 2026-07-28 — BB2-DIRECT-05-FIX7 — complete identity deployment

- Permission blocker reproduced: restrictive wheel-install umask left package directories/files inaccessible to the service user; package presence and root import were confirmed. Deterministic root-owned/readable/non-writable normalization corrected the Direct tree.
- Exact tested wheel `business_bridge_2_direct-0.4.0-py3-none-any.whl`, SHA-256 `5ab039200e396b6557b83593682d928a408fbcdba88b8ae40ea48f9118b472a0`.
- Existing identity was preserved: instance `73515b73-a4d3-41c7-b143-624ce2a42eb5`, fingerprint `sha256:b0adfb05bd25e9684279494aa8054191dca70784fab416a29ec699b737111bc4`, generation 1. Metadata migrated atomically to the nested path; private key was not replaced.
- Fresh backup `/var/backups/business-bridge-2-direct/BB2-DIRECT-05-FIX7-20260728T103143Z/`; scratch identity and SQLite restore validation PASS.
- Full tests 29/29 PASS; active Direct service is non-root, version 0.4.0, exact public listener and stable bootstrap. One manual controlled restart was issued; a Direct-only TIME_WAIT bind defect was corrected with `allow_reuse_address=True`, after which the same systemd recovery sequence became active/running. No second manual restart was issued.
- Legacy remained PID `1619365`, start `Mon 2026-07-27 13:16:29 MSK`, NRestarts 0, listener `127.0.0.1:18083`, health 200, unchanged and not restarted. Main remains unchanged.
- Evidence: `BB2-DIRECT-05_INSTANCE_IDENTITY_EVIDENCE.md`, `BB2-DIRECT-05_BOOTSTRAP_RESULTS.json`, `BB2-DIRECT-05_PERMISSION_TEST_RESULTS.json`. Acceptance marker: `BB2_DIRECT_05_COMPLETE`.

Следующий ран: `BB2-DIRECT-06` — одноразовое pairing; не выполнялся.
