# ADR-002: Application-layer cryptography

**Статус:** ACCEPTED FOR IMPLEMENTATION

Direct использует application-layer encryption поверх carrier. Server fingerprint и signature помогают удостоверить identity, но fingerprint не заменяет шифрование. Baseline: ECDH/ECDSA P-256, HKDF-SHA-256, AES-256-GCM, SHA-256, nonce, timestamp, expiry, sequence, request ID и replay protection. Envelope versioned и authenticated; browser/server compatibility и test vectors реализуются в BB2-DIRECT-07. Последствия: нужны rotation/revoke, совместимое управление nonce/sequence и redacted logs; carrier не должен считаться доверенным.
## BB2-DIRECT-07 protocol profile

The accepted profile is BB2D-P1: P-256 ECDH per session, stable server and paired-device P-256 ECDSA identities, low-S 64-byte P1363 signatures, HKDF-SHA-256 and directional AES-256-GCM. Canonical JSON is sorted-key UTF-8 without insignificant whitespace; timestamps are whole-second UTC and messages expire within 60 seconds. Sessions are memory-only and require a fresh handshake after restart. Schema 3 stores only safe replay/sequence metadata; secrets and plaintext are never persisted or logged.

The browser AES-GCM byte contract is explicit: Web Crypto output is `ciphertext||tag`, with the final 16 bytes as the tag. The wire field is one unpadded base64url encoding of that combined value; decoding and AESGCM input occur exactly once. Browser ECDSA signatures are normalized to low-S P1363, and signed binary transcripts concatenate bytes directly; nonce is included once.
