# Business Bridge 2 Direct — журнал работ

## 2026-08-02 — BB2-DIRECT-11 — server profiles in extension

- ChatGPT-owned `BB2-DIRECT-11-EXT` принят после независимого post-publish audit. Accepted base: `63be0af894fe27252ace7fa6eb7480b624df1be4`; extension implementation `650d5dab847dec4e3d72e9f9a3e70190f693b65b`; evidence `58cc89c4cb14afaae552b64870c23b23ffc26e73`. Implementation меняет только `extension/**`; server/runtime/installer не менялись.
- Extension `2.0.0.21`, settings schema `5`, добавляет отдельные Direct server profiles: strict BB2D1 paste/preview, explicit fingerprint confirmation, browser-generated P-256 device identity, one-time pairing, pinned server identity, signed BB2D-L1 status/connect/revoke, local disconnect/rename/delete, identity-change warning, multiple separate profiles and migration `4→5`.
- Direct private keys хранятся отдельно в `bb2_direct_private_keys`; worker устанавливает `chrome.storage.local` access level `TRUSTED_CONTEXTS`. Content script не загружает Direct key code; Direct management messages from tab/content-script sender fail closed. Diagnostics redact private/token/credential/pairing fields. Backup переносит Direct metadata, но исключает private keys/key_ref; профиль без local key восстанавливается как `NEEDS_REPAIR`.
- Legacy endpoint validation и Legacy profile/token/binding flow не ослаблены. Direct optional host permission запрашивается только по user gesture для выбранного IPv4; точный port остаётся pinned profile property. `/v2/bootstrap` — только early mismatch signal, а trust устанавливается signed BB2D-L1 response под bundle-pinned server key.
- Full local extension regression на пользовательском v2.0.0.20 baseline + Run11: `123/123 PASS`. Chromium `144.0.7559.96` подтвердил real secure-context Web Crypto, unpacked MV3 worker, modular content-script runtime и popup, а также worker/popup из финально распакованного ZIP. Managed Chromium policy после каждого accepted run восстановлена byte-for-byte к SHA-256 `3b740260e337305aaef268e6c63af8fa2796057ce46f43df5ae5a3949e085e86`.
- Final authoritative package: `business-bridge-chatgpt-extension-v2.0.0.21-run11.zip`, 34 runtime members, SHA-256 `b9cda4ddffcda3909be7026ada8fd813b0a0faa4c333617852b390da286ed34b`; ZIP integrity, unpack equality, packaged JS syntax and unpacked Chromium worker/popup load PASS.
- Direct task/report transport намеренно не реализован преждевременно; он остаётся scope `BB2-DIRECT-12-EXT`.
- Marker: `BB2_DIRECT_11_COMPLETE`.
- Следующий ран: `BB2-DIRECT-12` — Direct extension transport, owner ChatGPT.

## 2026-08-02 — BB2-DIRECT-10 — connection bundle

- `BB2-DIRECT-10-SRV` принят после corrective attempts 5–7. Финальная append-only server chain: test-oracle correction `84dad3d7f1b7b47cea034491353d6998eda62eca` → corrected attempt-7 evidence commit `80f5725b5acf092337c6f23ea3ed73637cd6a567`. Runtime source после `8e128ee252c358aac2da7d8c0cea79ba1686b1e6` не менялся.
- Direct `0.9.0/schema 5` генерирует strict one-line `BB2D1` bundle с public endpoint, instance/server public identity, one-time pairing session/code, issue/expiry и rotation generation. Server attempt 7: 62/62 gates PASS; deterministic wheel SHA-256 `50fefc54cf102e1081523dd548fb4c9709a559b50364760791d8eb8097ca21d2`; production pairing first use `201`, reuse `403`, cleanup PASS.
- `BB2-DIRECT-10-EXT` выполнен ChatGPT без делегирования CLI. Published extension implementation commits from accepted server base through `f60ff8105dbd01197da1bf9db1f90d9ce1be546e` add only `extension/**`: pure `bb2d1-bundle.js`, Node regression, shared-fixture Chrome harness, self-contained Chromium contract harness and parser documentation. Server/runtime/installer не менялись.
- Browser parser fail-closed проверяет BB2D1 framing/version/length, canonical unpadded base64url, domain-separated SHA-256 checksum, canonical JSON/exact fields, timestamps/TTL/expiry, IPv4/port/UUID/pairing-code/generation, P-256 SPKI и exact DER fingerprint. Профили, pairing lifecycle, storage и Direct transport не реализованы преждевременно; они остаются scope BB2-DIRECT-11+.
- Node 22.16.0 smoke/static acceptance PASS. Chromium `144.0.7559.96`, secure localhost, real `globalThis.crypto.subtle`: 6/6 independent runs, canonical positive PASS, 38/38 negative contract cases per run (228/228 total), including malformed/corrupt/noncanonical/expiry, P-384 and RSA SPKI rejection.
- Chromium managed policy was temporarily relaxed only for isolated local browser testing and restored byte-for-byte to SHA-256 `3b740260e337305aaef268e6c63af8fa2796057ce46f43df5ae5a3949e085e86`. An initial cleanup-script PROCESS mistake was detected immediately, restored from the preserved backup, and the complete 6-run acceptance was repeated with correct `finally` cleanup and identical pre/post policy hashes.
- Extension evidence: `docs/development/evidence/BB2-DIRECT-10-EXT_CHATGPT_EVIDENCE.md`. Acceptance/security documentation updated. Legacy remained unchanged; `main` remained `c426263e6dd00135a0023a0fa08a500273e73e23`.
- Marker: `BB2_DIRECT_10_COMPLETE`.
- Следующий ран: `BB2-DIRECT-11` — server profiles in extension, owner ChatGPT.

## 2026-07-30 — BB2-DIRECT-09 — durable jobs and recovery

- Implementation commit `46ed6317b03ba9b84e52042cdd068379d02ad1b7` and evidence commit `168f80f3f9b3c3dcd27219c5f93aa15a2bb10236` were published linearly from accepted base `e41a6c7461e3a852a95da0e2f6cd6423c654b5c4`. `main` remained `c426263e6dd00135a0023a0fa08a500273e73e23`.
- Direct advanced to `0.8.0`, SQLite schema `5`. The runtime now has the ten approved durable states, immutable operation mapping, transition history, one-winner lease ownership, stale-owner rejection, startup recovery, cancellation, expiry, immutable durable reports and internal proof-gated reconciliation.
- Restart ambiguity is fail-closed: `RUNNING` without a proven durable result становится `UNKNOWN`, its lease is cleared and it is never automatically requeued. Duplicate operation IDs preserve the same task/report; a different canonical payload remains a deterministic conflict.
- Attempt 2 failed only at production activation because root-installed wheel files were inaccessible to `business-bridge-direct`. The corrected mechanism uses same-filesystem staging, umask `0027`, complete `lstat`/no-follow inventory, rejection of unsafe types/hardlinks/escapes, root/service-group ownership and safe modes, service-user imports and staged `identity_cli verify` before activation.
- Full source acceptance passed: server `58/58`, protocol `5/5`, migration, state machine, duplicate/lease races, stale-owner rejection, recovery, no-blind-retry, reconciliation, cancellation, expiry, durable reports, permission regression and secret scans.
- Three clean wheel builds were byte-identical: SHA-256 `c9d799d31ad19b34b8340269ef136fdc228e461dfc72641a2dc454a63401563e`, 20 members, RECORD/ZIP integrity PASS. Installed-wheel, protected TCP and negative matrices passed without repository imports.
- Isolated rollback and unsafe-staging rehearsals passed. Production service-user pre-activation probes and `ExecStartPre` passed; Direct activated and remained stable through production restart acceptance. Pending task identity/state survived restart, duplicate create returned the same task, conflict/cancel remained deterministic, completed task executed once and repeated report preserved ID/hash.
- Final Direct: PID `1917049`, active/running, `NRestarts=0`, health 200, listener `78.17.68.165:18100`, version `0.8.0`, schema `5`, identity/service user/group/system Python unchanged; synthetic pending tasks and active leases `0`.
- Final Legacy: PID `1619365`, start `2026-07-27 13:16:29 MSK`, `NRestarts=0`, listener `127.0.0.1:18083`, health 200, `MODIFIED=NO`, `RESTARTED=NO`.
- Independent ChatGPT audit: `docs/development/evidence/BB2-DIRECT-09_CHATGPT_AUDIT.md`.
- Marker: `BB2_DIRECT_09_COMPLETE`.
- Следующий ран: `BB2-DIRECT-10` — connection bundle.

## 2026-07-30 — BB2-DIRECT-08 — compatible task/report API

- Server implementation commit `ba9614dcd722fd77bf118f78427737f85bed2f6c` and evidence commit `92f622cbda5103c918af430b32c49f9d7762b44a` were published linearly from base `517dd10166ef1014dec3a3ef9fab49deadc0d51f`. `main` remained `c426263e6dd00135a0023a0fa08a500273e73e23`.
- Direct `0.7.0`, SQLite schema `4`, implements protected `task_create`, `task_status`, `task_cancel` and `task_report`, immutable operation IDs, canonical-payload idempotency, deterministic payload conflict and repeatable reports.
- The attempt-12 blocker was classified as PROCESS: the acceptance harness incorrectly attempted to decrypt a generic pre-authentication error. The harness now accepts strict non-sensitive JSON before authentication/decryption and still requires signed/encrypted status-bound `task_error` envelopes after authenticated application processing. Server runtime bytes did not change for this correction.
- Clean candidate tests passed: compileall, protocol suite and server suite `58 passed + 21 subtests`. The reproducible wheel SHA-256 is `142764858e13896b7e74186e9f2a519b0e1d82f5b70cbd16b86daf62dfa8e7a8`.
- Source TCP, installed-wheel TCP, negative matrices, isolated rollback rehearsal and production task/report acceptance passed. Production package members already matched, therefore Direct package mutation and restart were both `NO`.
- Final Direct remained PID `1823652`, active/running, `NRestarts=0`, public listener `78.17.68.165:18100`, health 200, version 0.7.0 and schema 4. System Python and Direct identity were unchanged.
- Legacy remained PID `1619365`, start time `Mon 2026-07-27 13:16:29 MSK`, `NRestarts=0`, listener `127.0.0.1:18083`, health 200, `MODIFIED=NO`, `RESTARTED=NO`.
- Independent ChatGPT Chromium verification used Chromium `144.0.7559.96` and real `globalThis.crypto.subtle`. Six of six secure-context runs passed 15 published canonical/AAD/domain vector groups plus ECDSA P-256, ECDH P-256, HKDF-SHA-256, AES-256-GCM, tag split/join and tamper rejection. Evidence: `docs/development/evidence/BB2-DIRECT-08_CHATGPT_CHROMIUM_EVIDENCE.md`.
- Marker: `BB2_DIRECT_08_COMPLETE`.
- Следующий ран: `BB2-DIRECT-09` — durable jobs and recovery.

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

### Результат

На сервере одновременно существуют:

- действующий Bridge на `127.0.0.1:18083`;
- свободный диапазон для новой Direct-службы;
- публичный IPv4 `78.17.68.165`.

Следующий ран: `BB2-DIRECT-01` — архитектурный и продуктовый контракт.

---

## BB2-DIRECT-01 — Architecture & product contract

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Новый server-side компонент устанавливается отдельно от Legacy Bridge.
- Direct использует отдельный systemd unit, user, virtualenv, DB, state, config, logs, identity и secrets.
- Публичный TCP endpoint — `78.17.68.165:18100`.
- Никакой домен, relay, VPN, desktop helper или SSH-туннель не является обязательным элементом финального пользовательского потока.
- Legacy Bridge остаётся immutable fallback до финального release.
- Парное устройство проходит one-time pairing и получает собственную durable identity.
- Прикладной трафик после pairing защищается device authentication + encrypted/signed session protocol.
- Browser extension никогда не передаёт private device key в page context.

Marker: `BB2_DIRECT_01_COMPLETE`.

Следующий ран: `BB2-DIRECT-02`.

---

## BB2-DIRECT-02 — Isolated source baseline

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Создан отдельный server package `business-bridge-direct`.
- Direct source не импортирует и не копирует Legacy DB/state/secrets.
- Определены отдельные Direct roots `/opt/business-bridge-2-direct`, `/etc/business-bridge-2-direct`, `/var/lib/business-bridge-2-direct`, `/var/log/business-bridge-2-direct`.
- Source/test layout подготовлен к самостоятельной сборке wheel и дальнейшей установке.
- Legacy runtime остаётся неизменным.

Marker: `BB2_DIRECT_02_COMPLETE`.

Следующий ран: `BB2-DIRECT-03`.

---

## BB2-DIRECT-03 — Local Direct service

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Direct service запускается отдельным unit `business-bridge-2-direct.service`.
- Runtime user: `business-bridge-direct`.
- Local health contract доступен без чтения Legacy state.
- Direct version/schema metadata доступны из собственного runtime.
- systemd isolation и dedicated paths проверены.

Marker: `BB2_DIRECT_03_COMPLETE`.

Следующий ран: `BB2-DIRECT-04`.

---

## BB2-DIRECT-04 — Public IPv4 endpoint

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Direct bind переведён на публичный IPv4 `78.17.68.165:18100`.
- Listener принадлежит только Direct process.
- Public health reachability подтверждена.
- Legacy listener `127.0.0.1:18083` остался неизменным.

Marker: `BB2_DIRECT_04_COMPLETE`.

Следующий ран: `BB2-DIRECT-05`.

---

## BB2-DIRECT-05 — Instance identity

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Direct имеет отдельную stable instance identity.
- Создана отдельная P-256 signing identity.
- Public fingerprint и public key доступны через Direct bootstrap contract.
- Private signing key находится только в Direct secrets boundary.
- Rotation generation хранится отдельно и входит в identity metadata.
- Legacy identity/secrets не читаются и не копируются.

Marker: `BB2_DIRECT_05_COMPLETE`.

Следующий ран: `BB2-DIRECT-06`.

---

## BB2-DIRECT-06 — One-time pairing

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Pairing session имеет TTL и одноразовый code verifier.
- Plaintext pairing code не хранится в DB.
- Pairing attempts ограничены.
- Successful pairing создаёт durable device identity с P-256 public key.
- Reuse pairing code отклоняется.
- Device revoke поддерживается server-side.
- Audit/log outputs redacted.

Marker: `BB2_DIRECT_06_COMPLETE`.

Следующий ран: `BB2-DIRECT-07`.

---

## BB2-DIRECT-07 — Protected application protocol

**Статус:** ACCEPTED / PASS

### Зафиксировано

- `BB2D-P1` использует authenticated device handshake.
- Session keys выводятся через P-256 ECDH + HKDF-SHA-256.
- Payload encryption — AES-256-GCM.
- Request/response signatures — P-256 ECDSA SHA-256.
- Canonical request/response domains и AAD frozen and tested.
- Replay, stale timestamp, sequence and tamper failures fail closed.
- Real browser Web Crypto interoperability подтверждена.

Marker: `BB2_DIRECT_07_COMPLETE`.

Следующий ран: `BB2-DIRECT-08`.

---

## BB2-DIRECT-08 — Compatible task/report API

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Protected `task_create`, `task_status`, `task_cancel`, `task_report` реализованы.
- Immutable operation ID и canonical payload idempotency реализованы.
- Duplicate operation не выполняется повторно.
- Different payload под тем же operation даёт deterministic conflict.
- Report repeatable and immutable.
- Pre-auth failures возвращают generic non-sensitive plaintext error.
- Authenticated application errors возвращаются signed/encrypted внутри `BB2D-P1`.
- Real Chromium Web Crypto probe подтверждает wire compatibility.

Marker: `BB2_DIRECT_08_COMPLETE`.

Следующий ран: `BB2-DIRECT-09`.

---

## BB2-DIRECT-09 — Durable jobs and recovery

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Durable operation ledger использует состояния `CREATED`, `QUEUED`, `ACCEPTED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`, `UNKNOWN`, `EXPIRED`.
- Durable reports и transition history сохраняются отдельно от Legacy.
- Lease ownership и stale-owner protection не допускают двух исполнителей одной операции.
- Startup recovery не делает blind retry.
- Ambiguous `RUNNING` после restart становится `UNKNOWN`, пока результат не доказан.
- Reconciliation, cancellation, expiry и repeated report прошли production restart acceptance.

Marker: `BB2_DIRECT_09_COMPLETE`.

Следующий ран: `BB2-DIRECT-10`.

---

## BB2-DIRECT-10 — Connection bundle

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Server генерирует strict one-line `BB2D1` bundle без permanent private secret.
- Bundle содержит public IPv4/port, instance identity/fingerprint/SPKI, pairing session/code, issue/expiry и rotation generation.
- Browser parser проверяет framing, checksum, canonical JSON, exact fields, TTL/expiry, P-256 SPKI/fingerprint и malformed/corrupt variants fail closed.
- Shared server/browser vectors и real Chromium Web Crypto acceptance прошли.

Marker: `BB2_DIRECT_10_COMPLETE`.

Следующий ран: `BB2-DIRECT-11`.
