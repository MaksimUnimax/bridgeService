# ADR-002: Application-layer cryptography

**Статус:** ACCEPTED FOR IMPLEMENTATION

Direct использует application-layer encryption поверх carrier. Server fingerprint и signature помогают удостоверить identity, но fingerprint не заменяет шифрование. Baseline: ECDH/ECDSA P-256, HKDF-SHA-256, AES-256-GCM, SHA-256, nonce, timestamp, expiry, sequence, request ID и replay protection. Envelope versioned и authenticated; browser/server compatibility и test vectors реализуются в BB2-DIRECT-07. Последствия: нужны rotation/revoke, совместимое управление nonce/sequence и redacted logs; carrier не должен считаться доверенным.
