# BB2-DIRECT-11-EXT — ChatGPT extension acceptance evidence

TECHNICAL_ID: `BB2-DIRECT-11-EXT`
PARENT_RUN: `BB2-DIRECT-11`
OWNER: ChatGPT
STATUS: PASS

## Git boundary

- Accepted server/lifecycle base: `63be0af894fe27252ace7fa6eb7480b624df1be4`.
- Extension implementation commit: `650d5dab847dec4e3d72e9f9a3e70190f693b65b`.
- Implementation diff: 41 changed paths, all under `extension/**`; no `server/**`, `installer/**`, governance or `main` mutation.
- Extension version: `2.0.0.21`.
- Settings schema: `5`.
- Legacy endpoint validation remains localhost/tunnel-only; Direct uses a separate profile/storage/network path.

## Implemented

- strict paste/decode of accepted `BB2D1` bundle through the run-10 pure browser parser;
- preview of IPv4, port, instance ID, expiry and SHA-256 server fingerprint;
- explicit operator identity confirmation before pairing;
- optional exact-host Chrome permission request initiated by the pairing/connect/status/revoke user gesture;
- independent P-256 device identity generation;
- one-time `/v2/pairing/complete` pairing;
- immediate signed `BB2D-L1 status` verification before a Direct profile becomes connected;
- server instance ID, P-256 SPKI, fingerprint and rotation generation pinning;
- separate Direct profile model and private-key vault;
- local rename;
- signed status;
- signed connect verification;
- local disconnect without revoke;
- signed idempotent revoke;
- distinct local delete with explicit warning when the remote device is still ACTIVE;
- fail-closed identity-change warning;
- multiple independent Direct profiles and device keys;
- settings migration `4 -> 5`;
- backup/restore of Direct metadata with intentional private-key exclusion; restored metadata without a key becomes `NEEDS_REPAIR`;
- existing Legacy profiles, Legacy credentials, bindings and Legacy runtime behavior preserved.

Direct task/report transport is intentionally not implemented in this run and remains scope of `BB2-DIRECT-12-EXT`.

## Security boundary

- `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})` is applied by the service worker.
- Direct private keys are stored under the separate `bb2_direct_private_keys` vault.
- The content script does not import Direct key/crypto profile code.
- Direct profile-management messages are rejected when the sender has a tab/content-script context.
- Popup/public profile objects expose only `has_private_key`, never PKCS8 or vault references.
- Diagnostics redact token, credential, secret, pairing-code, private-key and PKCS8 fields.
- Settings export has `contains_direct_private_keys: false` and removes key references from Direct metadata.
- `/v2/bootstrap` is only an early advertised-identity mismatch signal; it never establishes trust. Successful connection requires a valid signed `BB2D-L1` response under the bundle-pinned server key.
- No private device key, server private key or pairing code is present in this evidence.

## Node regression

Final local candidate command:

`node --test --test-concurrency=1 tests/*.test.mjs`

Result:

- tests: `123`
- PASS: `123`
- FAIL: `0`
- skipped: `0`

This includes the complete pre-run-11 Legacy regression baseline plus new Direct profile/lifecycle/storage/UI cases. New worker integration cases include separate profile/key isolation, signed lifecycle behavior, trusted-sender restriction, schema migration, identity-change warning, backup private-key exclusion and Legacy-preserving restore.

## Chromium acceptance

Chromium: `144.0.7559.96`.

All browser runs used isolated temporary profiles and restored managed Chromium policy byte-for-byte in `finally` cleanup.

Managed policy SHA-256 before and after every accepted run:

`3b740260e337305aaef268e6c63af8fa2796057ce46f43df5ae5a3949e085e86`

Accepted browser gates:

1. Real secure-context Web Crypto (`globalThis.crypto.subtle`) generates/exports/imports P-256 device material, signs a `BB2D-L1` request, verifies a server-signed response under a pinned P-256 server key and rejects identity change.
2. Real unpacked MV3 service worker loads all worker parts, imports `BB2Direct`, reports version `2.0.0.21` / settings schema `5`, and keeps the private-vault storage key in the trusted extension worker context.
3. Real Chromium content-script injection loads the modular content parts in one isolated world and answers `BB2_PING` as content version `2.0.0.21`.
4. Real final-package MV3 service worker loads from the unpacked ZIP.
5. Real final-package popup loads `popup/part1.js -> popup/part2.js -> popup/part3.js`, exposes all Direct bundle/pair/status/connect/disconnect/rename/revoke/delete controls, has a working `chrome.permissions.request` boundary, and contains no PKCS8/vault-key text in its DOM.

## Source-layout process corrections during acceptance

Large classic scripts were split only at top-level statement/function boundaries to make Git publication auditable through the available GitHub tooling:

- worker: `service_worker.js` loader + `worker/part1.js ... part12.js`;
- content script: manifest-ordered `content/part1.js ... part4.js`;
- popup: `popup/part1.js ... part3.js` loaded in order by `popup.html`.

Every source-layout change was followed by the complete Node regression and dependent Chromium checks. Static harnesses that assumed one monolithic source file were updated to read the logical concatenated source. These were PROCESS/harness corrections; no product contract was changed by the split.

## Package acceptance

Final authoritative runtime package:

`business-bridge-chatgpt-extension-v2.0.0.21-run11.zip`

Runtime members: `34`.

SHA-256:

`b9cda4ddffcda3909be7026ada8fd813b0a0faa4c333617852b390da286ed34b`

Acceptance:

- deterministic timestamp/mode packaging: PASS;
- ZIP integrity: PASS;
- unpack inventory: PASS;
- unpacked files byte-for-byte equal to accepted candidate: PASS;
- syntax check of every packaged JavaScript file: PASS;
- unpacked ZIP loaded as a real MV3 extension in Chromium: PASS;
- packaged worker runtime: PASS;
- packaged popup runtime/UI/permission boundary: PASS.

Earlier package SHAs produced before final source-layout modularization are historical only and are not authoritative Run11 artifacts.

## Acceptance summary

- bundle paste/preview: PASS
- explicit confirmation: PASS
- pairing implementation: PASS
- profile model: PASS
- private device-key storage: PASS
- profile rename: PASS
- status: PASS
- connect/disconnect: PASS
- delete: PASS
- revoke: PASS
- identity-change warning: PASS
- multiple separate profiles: PASS
- schema migration: PASS
- Legacy profile preservation: PASS
- Node regression: PASS
- real Chromium/WebCrypto: PASS
- page-context secret isolation: PASS
- storage isolation: PASS
- log redaction: PASS
- ZIP unpack/retest: PASS
- server changed by extension step: NO
- Legacy server changed/restarted by extension step: NO
- `main` changed: NO

NEXT_EXPECTED_STEP: `BB2-DIRECT-12-EXT`
