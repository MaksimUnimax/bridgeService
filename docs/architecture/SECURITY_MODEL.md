# Security model

## Активы и границы

Активы: device/server identity, pairing session, operation IDs, prompts, reports, keys, DB/state и logs. Границы доверия: browser storage, public network, VPS listener, server runner и CLI. Сеть недоверенна.

## Threats and controls

В текущем public surface доступны только `GET /v2/health`, `/v2/version` и `/v2/diagnostics/public`; prompts, reports, tasks, identity, pairing и crypto отсутствуют. Direct 0.3.0 применяет timeout 5 s, request line 2048 B, headers 8192 B/32, body 4096 B, concurrency 16, backlog 32, per-source 30/10 s и global 120/10 s. Это базовые DoS controls, но они не делают plaintext HTTP или сервис production-ready.

MITM и подмена сервера — fingerprint, server signature и authenticated key agreement; fingerprint не заменяет шифрование. Replay — nonce, timestamp, expiry, sequence, request ID и replay ledger. Brute force pairing — одноразовый code TTL 5–10 минут, attempt/rate limits и audit. Украденный bundle — expiry/single-use pairing и revoke; bundle не содержит постоянный private key и не является бессрочным credential. Украденное extension storage — отдельная device identity, защищённое storage, revoke и повторное pairing. Изменение ciphertext — AES-GCM authentication. Повтор operation ID — durable idempotency ledger.

Утечки логов предотвращаются redaction prompts/reports/credentials/cookies. Публичный listener ограничивает методы, размер, concurrency, скорость и timeout; DoS остаётся риском доступности и проверяется тестами. Runner изолирован отдельным user/paths и минимальными permissions; модель не получает больше прав, чем CLI пользователя, и криптография не заменяет sandbox/OS controls.

## Cryptographic baseline

Предпочтительный baseline: ECDH P-256; ECDSA P-256; HKDF-SHA-256; AES-256-GCM; SHA-256; nonce; timestamp; expiry; sequence; request ID; replay ledger. Envelope versioned, signature-checked и browser/server-compatible. Реализация и test vectors относятся к BB2-DIRECT-07.

## Lifecycle

Pairing code одноразовый; server/device revoke немедленно блокирует session. Rotation имеет metadata и требует fingerprint confirmation; backup boundary для identity keys проходит только по отдельным Direct backup/restore, при identity change extension предупреждает и не принимает сервер молча. Permanent secret в connection bundle не допускается. Secret storage — отдельные права Direct; old Bridge secrets не читаются и не переиспользуются.

### BB2-DIRECT-05 stable server identity

Direct has a stable UUIDv4 identity and separate ECDSA P-256 signing key in unencrypted PKCS#8 PEM. The public key is canonical DER SubjectPublicKeyInfo, transferred as unpadded base64url; fingerprint is SHA-256 over exact DER bytes. Startup validates permissions, curve, public-key equality, fingerprint and possession before binding. `/v2/bootstrap` is unauthenticated discovery and does not authenticate the server or replace encryption. Pairing is BB2-DIRECT-06; signed/encrypted transport is BB2-DIRECT-07. Rotation requires separate backup and explicit confirmation; no production rotation occurred.
