# ADR-003: Pairing and device identity

**Статус:** ACCEPTED FOR IMPLEMENTATION

CLI выдаёт одноразовые pairing-данные в connection bundle. TTL — 5–10 минут, одно использование, attempt/rate limits и audit. Каждая установка extension имеет отдельную device identity; общий постоянный bearer token единственной защитой запрещён. Bundle не содержит постоянный private key и не является бессрочным credential. Revoke инвалидирует device/session; повторное pairing требуется после revoke или identity rotation. Identity change требует явного подтверждения fingerprint. Реализация — BB2-DIRECT-05/06/10, security tests — BB2-DIRECT-17.
