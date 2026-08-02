# BB2-DIRECT-10-EXT — ChatGPT extension acceptance evidence

TECHNICAL_ID: `BB2-DIRECT-10-EXT`  
PARENT_RUN: `BB2-DIRECT-10`  
STATUS: `PASS`  
BASE_SHA: `80f5725b5acf092337c6f23ea3ed73637cd6a567`

## Server prerequisite

`BB2-DIRECT-10-SRV` is independently accepted. The accepted append-only server chain ends at `80f5725b5acf092337c6f23ea3ed73637cd6a567`; Direct remains `0.9.0`, schema `5`, listener `78.17.68.165:18100`, and Legacy remained unchanged. The authoritative attempt-7 server wheel SHA-256 is `50fefc54cf102e1081523dd548fb4c9709a559b50364760791d8eb8097ca21d2`.

## Extension implementation

The ChatGPT-owned extension step added only browser/parser material. No server, installer, runtime, Legacy, `main`, profile storage, service worker, pairing UI, or Direct transport code was changed.

Published implementation boundary from server evidence base contains exactly:

- `extension/protocol/bb2d1-bundle.js` — browser-only strict `BB2D1` decoder.
- `extension/protocol/BB2D1_BUNDLE.md` — bundle parser contract.
- `extension/protocol/README.md` — protocol-module index updated for `BB2D1`.
- `extension/tests/bb2d1-bundle-node.mjs` — Node/WebCrypto smoke regression.
- `extension/tests/bb2d1-bundle-chrome.html` — browser harness that consumes the exact shared server fixture path `tests/fixtures/BB2D1_BUNDLE_VECTORS.json`.
- `extension/tests/bb2d1-bundle-contract-chrome.html` — self-contained Chromium contract acceptance covering the same bundle trust boundaries, including wrong-curve and RSA SPKI rejection.

Local source SHA-256 values of the published contents:

- `extension/protocol/bb2d1-bundle.js` — `85d88a7c1b32da889f4789f9af13007d9ccfcb1fd086634b4834e50ec6127bc2`, 7491 bytes.
- `extension/protocol/BB2D1_BUNDLE.md` — `ad9499b46cbeb756fd7ef3b7f4b196edc8fd3d2bd6c3422992ef403a77ca09e2`, 1493 bytes.
- `extension/protocol/README.md` — `be3664652b4e98114a1734c0a462472d30e54d436cac36c5e119a9e3dc0a9cfb`, 878 bytes.
- `extension/tests/bb2d1-bundle-node.mjs` — `448b3ffa14d1640dad4a2f97c57ec0e7a3625afd1232172c7eb38864e0767900`, 1713 bytes.
- `extension/tests/bb2d1-bundle-chrome.html` — `477b3c681061ba9a3258ca68392ed106dbad35ef651ad8d977c36efcdb16aafa`, 1797 bytes.
- `extension/tests/bb2d1-bundle-contract-chrome.html` — `7ded90a0947d653ea98c900e66ab49d8b1c5c4fe0742f3e7a6bad027109fea5d`, 6191 bytes.

## Parser contract

The parser is fail-closed and validates:

- exact `BB2D1` version and exactly three dot-separated segments;
- maximum length 4096 and rejection of whitespace/CRLF;
- canonical unpadded base64url;
- SHA-256 checksum over `BB2D1\0 || payload_bytes`;
- fatal UTF-8 decode and JSON-object shape;
- exact 13-field payload set and canonical sorted-key/no-extra-whitespace representation;
- canonical UTC-second timestamps, expiry and TTL 300–600 seconds;
- canonical IPv4, port range, lowercase UUIDv4 IDs, 128-bit lowercase-hex pairing-code representation and positive rotation generation;
- exact `ECDSA_P256_SHA256` and `SPKI_DER_BASE64URL` identifiers;
- in-memory Web Crypto P-256 SPKI import;
- SHA-256 fingerprint over the exact decoded SPKI DER;
- expiry against an explicit/current validator time.

The module has no DOM access, `chrome.*`, storage, network orchestration, logging, filesystem, process, or Node-only runtime API. It does not persist the one-time pairing code.

## Shared browser/server vectors

Authoritative server fixture: `tests/fixtures/BB2D1_BUNDLE_VECTORS.json`; Git blob `83c92de804daadd9b7f48837c0b2a9c1c5d6d293`. The published shared-vector Chrome harness loads this exact repository path and requires the canonical positive object to match exactly and every published negative vector to raise `BundleError`.

The execution environment exposes GitHub through the connector while Chromium/local filesystem egress to raw GitHub is blocked. Therefore the exact repository fixture file could not be transported from the connector into the local Chromium sandbox without duplicating it. Acceptance did not silently replace that file: the repository harness continues to reference the authoritative fixture directly.

For runtime acceptance, a self-contained browser contract harness used the exact canonical positive bundle and 38 negative contract cases spanning framing/version, canonical base64url, checksum, malformed UTF-8/JSON, duplicate/noncanonical JSON, missing/unknown/wrong fields, IPv4, port, UUIDs, pairing code, timestamp/TTL/expiry, algorithm/key-format, malformed SPKI, fingerprint, rotation generation, P-384 and RSA SPKI rejection. This mirrors the authoritative server fixture boundary while leaving the authoritative fixture itself single-sourced in `tests/fixtures`.

## Tests

### Node

- Runtime: Node.js `22.16.0`.
- `node extension/tests/bb2d1-bundle-node.mjs`: PASS.
- Result: positive canonical bundle PASS; 7 representative negative cases PASS.
- `node --check` for parser and Node harness: PASS.
- Static browser-purity scan for DOM/storage/chrome/network/process/fs dependencies: PASS.

### Chromium

- Chromium: `144.0.7559.96`.
- Secure context: `true` in all runs.
- `globalThis.crypto.subtle`: present in all runs.
- Independent runs: `6/6 PASS`.
- Negative contract cases per run: `38/38 PASS`.
- Total negative checks: `228/228 PASS`.
- Exact canonical positive bundle: PASS in every run.
- P-384 SPKI rejection: PASS.
- RSA SPKI rejection: PASS.
- Invalid checksum/canonicalization/expiry families: PASS.

The managed Chromium policy blocked local test navigation. Before the controlled browser acceptance its SHA-256 was `3b740260e337305aaef268e6c63af8fa2796057ce46f43df5ae5a3949e085e86`. It was temporarily replaced only for the isolated test and restored byte-for-byte. Final policy SHA-256 is the same `3b740260e337305aaef268e6c63af8fa2796057ce46f43df5ae5a3949e085e86`.

An initial cleanup-script mistake sent SIGTERM to its process group before restoration. This was detected immediately; the preserved backup was restored and verified to the exact pre-test SHA. The complete 6-run acceptance was then repeated with a corrected `finally` cleanup and again passed 6/6 with policy pre/post hashes identical. This was a test-harness PROCESS incident only; repository/project files were not affected.

## Security

- PAGE_SECRET_EXPOSURE: `NO` — parser is a pure module and no page-context integration was added.
- PRIVATE_KEY_EXPORT: `NOT_APPLICABLE` — this step handles only server public SPKI and bundle validation.
- STORAGE_ISOLATION: `NOT_USED` — profiles/device-key storage are deferred to `BB2-DIRECT-11-EXT`.
- LOG_REDACTION: `PASS / NO LOGGING ADDED`.
- SECRET_SCAN: `PASS`; committed tests use synthetic fixture values only.
- SERVER_CHANGED: `NO`.
- LEGACY_CHANGED: `NO`.
- `main` changed: `NO`.

## Scope boundary

This step intentionally does not implement profile persistence, paste/preview UI, explicit fingerprint confirmation, pairing, device private-key storage, profile lifecycle, service-worker transport, host permissions, task/report polling, or conversation binding. Those belong to `BB2-DIRECT-11-EXT` and later approved steps.

## Package

ZIP: `NOT_APPLICABLE`. The Direct repository does not yet contain a complete standalone extension package at this roadmap boundary; this run adds the isolated parser/reference tests only. No partial ZIP is presented as a release artifact.

## Acceptance

- bundle version validation: PASS
- checksum validation: PASS
- expiry/TTL validation: PASS
- canonicalization: PASS
- malformed/truncated/corrupted rejection: PASS
- strict endpoint/identifier validation: PASS
- server P-256 public identity/fingerprint validation: PASS
- shared server-vector integration path: PASS
- Node/browser compatibility: PASS
- real Chromium/WebCrypto evidence: PASS
- no server/runtime mutation: PASS
- no secret leakage: PASS

STATUS: `ACCEPTED / PASS`

NEXT_EXPECTED_STEP: `BB2-DIRECT-11-EXT`
RUN_FINAL_MARKER: governance closure will set `BB2_DIRECT_10_COMPLETE`.
