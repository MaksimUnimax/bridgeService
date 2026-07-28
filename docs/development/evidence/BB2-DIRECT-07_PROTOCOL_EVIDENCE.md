# BB2-DIRECT-07 protocol acceptance

Accepted implementation: Direct 0.6.0, schema 3, protocol `BB2D-P1`. The session endpoint authenticates the paired persistent device ECDSA P-256 key, verifies a fresh ephemeral P-256 ECDH key, and returns a server-signed response bound to instance and fingerprint. HKDF-SHA-256 derives 64 bytes from both nonces and a length-delimited context; AES-256-GCM keys are directional. Wire signatures are canonical 64-byte low-S IEEE-P1363 values.

The protected probe is synthetic only. Production acceptance paired a temporary device through the public endpoint, completed a signed handshake and bidirectional encrypted probe, rejected tamper and exact replay, then revoked the device. No private key, pairing code, sentinel, plaintext, traffic key or complete ciphertext envelope is present in this evidence. The original device remained paired and active; synthetic devices were revoked.

Schema 2→3 was atomic and preserved pairing state, identity, fingerprint and rotation generation. Restart invalidates in-memory sessions and a fresh handshake does not require re-pairing. BB2-DIRECT-08 task/report API was not executed.
