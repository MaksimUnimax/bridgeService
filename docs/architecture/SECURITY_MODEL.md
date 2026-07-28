# Security model

## Активы и границы

Активы: device/server identity, pairing session, operation IDs, prompts, reports, keys, DB/state и logs. Границы доверия: browser storage, public network, VPS listener, server runner и CLI. Сеть недоверенна.

## Threats and controls

MITM и подмена сервера — fingerprint, server signature и authenticated key agreement; fingerprint не заменяет шифрование. Replay — nonce, timestamp, expiry, sequence, request ID и replay ledger. Brute force pairing — одноразовый code TTL 5–10 минут, attempt/rate limits и audit. Украденный bundle — expiry/single-use pairing и revoke; bundle не содержит постоянный private key и не является бессрочным credential. Украденное extension storage — отдельная device identity, защищённое storage, revoke и повторное pairing. Изменение ciphertext — AES-GCM authentication. Повтор operation ID — durable idempotency ledger.

Утечки логов предотвращаются redaction prompts/reports/credentials/cookies. Публичный listener ограничивает методы, размер, concurrency, скорость и timeout; DoS остаётся риском доступности и проверяется тестами. Runner изолирован отдельным user/paths и минимальными permissions; модель не получает больше прав, чем CLI пользователя, и криптография не заменяет sandbox/OS controls.

## Cryptographic baseline

Предпочтительный baseline: ECDH P-256; ECDSA P-256; HKDF-SHA-256; AES-256-GCM; SHA-256; nonce; timestamp; expiry; sequence; request ID; replay ledger. Envelope versioned, signature-checked и browser/server-compatible. Реализация и test vectors относятся к BB2-DIRECT-07.

## Lifecycle

Pairing code одноразовый; server/device revoke немедленно блокирует session. Rotation имеет metadata и требует fingerprint confirmation; при identity change extension предупреждает и не принимает сервер молча. Secret storage — отдельные права Direct; old Bridge secrets не читаются и не переиспользуются.
