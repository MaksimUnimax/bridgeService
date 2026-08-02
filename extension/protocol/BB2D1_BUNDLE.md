# BB2D1 browser bundle parser

`bb2d1-bundle.js` is the browser-side parser for the server-generated `BB2D1` connection bundle.

The parser is intentionally pure with respect to extension state: it uses Web Crypto for SHA-256 and P-256 SPKI validation but has no DOM, `chrome.*`, storage, network, logging, or privileged API access.

It validates, fail-closed:

- exact `BB2D1` three-segment framing and the 4096-character limit;
- canonical unpadded base64url;
- SHA-256 checksum over `BB2D1\0 || canonical_payload_bytes`;
- UTF-8 JSON object shape, exact field set, canonical key order and no extra JSON whitespace/duplicate-key representation;
- canonical UTC-second timestamps and TTL 300–600 seconds;
- expiry against the supplied/current validator time;
- canonical IPv4, port, UUIDv4 IDs, one-time pairing-code syntax and positive rotation generation;
- exact signing algorithm/key-format identifiers;
- in-memory Web Crypto import of a P-256 SPKI public key;
- SHA-256 fingerprint of the exact decoded SPKI DER.

The authoritative compatibility vectors are shared with the server at `tests/fixtures/BB2D1_BUNDLE_VECTORS.json`. `extension/tests/bb2d1-bundle-chrome.html` loads that exact file and requires the positive vector to decode exactly while every published negative vector fails with `BundleError`.

The parser itself still does not persist a profile or make network requests. `BB2-DIRECT-11-EXT` consumes its validated output in popup/service-worker code to implement explicit identity confirmation, one-time pairing and signed profile lifecycle. Direct task transport remains deferred to run 12.
