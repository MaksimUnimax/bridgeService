# BB2-DIRECT-07-FIX2 acceptance evidence

Status: PASS. This is a corrective continuation of BB2-DIRECT-07; BB2-DIRECT-08 was not executed.

## Root cause and correction

Primary class: `TAG_SPLIT_OR_CONCAT_MISMATCH`.

The exact failing boundary was the browser Web Crypto AES-GCM result. Web Crypto returns `ciphertext||tag` (final 16 bytes are the tag). The failing request carried the ciphertext portion without the tag at the HTTP mapping boundary, while Python `cryptography` correctly consumed the field as one AESGCM input. Redacted controlled evidence: plaintext length 121, expected combined length 137, ciphertext length 121, tag length 16; the no-tag variant was rejected fail-closed, and the corrected combined variant was accepted. No secret bytes were recorded.

The browser module now exposes `splitGcm`, `joinGcm`, `aesEncryptWire` and `aesDecryptWire`; the server has the matching 16-byte framing helpers. The canonical contract is one unpadded base64url field containing exactly `ciphertext||tag`, decoded exactly once and passed to Python AESGCM exactly once. The same correction also made raw-byte transcript concatenation explicit, includes nonce exactly once, and canonicalizes browser ECDSA P-1363 to low-S.

## Interoperability

- Protocol: BB2D-P1; ECDH P-256; HKDF-SHA-256; AES-256-GCM; 12-byte IV; 16-byte tag.
- Canonical JSON: sorted keys, UTF-8, no insignificant whitespace, exact integer/string types.
- Real browser: Google Chrome 147.0.7727.116 headless, `globalThis.crypto.subtle=true`.
- Production module: `extension/protocol/bb2d-p1.js`; no Node crypto used.
- Deterministic Chrome regression: combined 85 bytes, ciphertext 69 bytes, tag 16 bytes, round-trip PASS, short output rejection PASS.
- Production Chrome flow: pairing 201, handshake 200, Chrome→server probe 200, server→Chrome authenticated decrypt PASS. Redacted request vector: combined 137 bytes, ciphertext 121 bytes, tag 16 bytes, AAD 371 bytes; SHA-256 digests are in `BB2-DIRECT-07_FIX2_BYTE_BOUNDARY.json`.

## Test and deployment gates

- Source: 42 passed, 16 subtests.
- Wheel: exact `business_bridge_2_direct-0.6.0-py3-none-any.whl`, 23,298 bytes, SHA-256 `083db710d7251fc40d84833612f10d00d8725c4aac26335482e3559d04a9ceb0`, ZIP integrity PASS, metadata/RECORD PASS, secret scan PASS.
- Staging isolated install: 42 passed, 16 subtests.
- Installed package: repository, wheel and production `protocol.py`/`protocol_crypto.py` hashes match; service-user import PASS and package write attempt FAIL.
- Direct: 0.6.0, schema 3, SQLite integrity `ok`, listener exactly `78.17.68.165:18100`, health 5/5 HTTP 200, five stability checks PASS, `NRestarts=0`.
- Exactly one planned Direct restart was performed. Identity, fingerprint, rotation generation and private-key metadata were preserved. Current-task synthetic devices were revoked; active synthetic count is 0.
- Legacy: PID/start timestamp/NRestarts/listener/health remained unchanged; no legacy mutation or restart.

Rollback is Direct-only: stop the Direct unit, restore the previous `.venv` and the consistent SQLite/config/identity material from the fresh `BB2-DIRECT-07-FIX2-20260728T130410Z` root-only backup, verify ownership and hashes, then start Direct. It never touches legacy Bridge or firewall.

Final marker: `BB2_DIRECT_07_COMPLETE`.
