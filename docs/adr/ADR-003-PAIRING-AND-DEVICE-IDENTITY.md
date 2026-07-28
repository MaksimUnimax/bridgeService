# ADR-003: Pairing and device identity

**Статус:** ACCEPTED FOR IMPLEMENTATION

CLI выдаёт одноразовые pairing-данные в connection bundle. TTL — 5–10 минут, одно использование, attempt/rate limits и audit. Каждая установка extension имеет отдельную device identity; общий постоянный bearer token единственной защитой запрещён. Bundle не содержит постоянный private key и не является бессрочным credential. Revoke инвалидирует device/session; повторное pairing требуется после revoke или identity rotation. Identity change требует явного подтверждения fingerprint. Реализация — BB2-DIRECT-05/06/10, security tests — BB2-DIRECT-17.
## BB2-DIRECT-05 server identity boundary

Direct server identity is a stable lowercase UUIDv4 plus an ECDSA P-256 signing key. Private material is unencrypted PKCS#8 PEM in Direct secrets only. Public identity is canonical SPKI DER, represented in bootstrap as unpadded base64url with `sha256:<64 lowercase hex>` over the exact DER bytes. Generation starts at 1; future rotation increments it, records the directly previous fingerprint, preserves instance_id, and requires explicit confirmation and a separate backup. Full replacement creates a new instance_id. Bootstrap is unauthenticated discovery and does not imply encryption. Device identity and pairing remain BB2-DIRECT-06.
