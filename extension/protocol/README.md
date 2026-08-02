# Business Bridge 2 Direct browser protocol modules

`bb2d-p1.js` is the pure Web Crypto reference for the protected `BB2D-P1` session protocol: canonical JSON, strict base64url, P-256 ECDSA/ECDH, HKDF-SHA-256 and AES-256-GCM. It has no DOM, storage, privileged API or network orchestration.

`bb2d1-bundle.js` is the pure browser parser for server-generated `BB2D1` connection bundles. It validates framing, checksum, canonical JSON, expiry/TTL, endpoint and identifier fields, P-256 SPKI identity and exact SHA-256 fingerprint without persisting or transmitting the bundle.

The authoritative server/browser compatibility fixture is `tests/fixtures/BB2D1_BUNDLE_VECTORS.json`. Browser harnesses live under `extension/tests/`.

`BB2-DIRECT-11-EXT` now owns the profile/pairing lifecycle around these pure primitives: explicit bundle preview/confirmation, isolated device-key storage, signed `BB2D-L1` status/revoke and pinned-identity warnings. Protected Direct task transport remains intentionally outside these modules until `BB2-DIRECT-12-EXT`.
