# BB2-DIRECT-11-EXT — acceptance contract

Status: `ACCEPTED / PASS`

Implementation: `650d5dab847dec4e3d72e9f9a3e70190f693b65b`

Evidence: `58cc89c4cb14afaae552b64870c23b23ffc26e73`

## Product gates

| Gate | Result |
|---|---|
| Paste strict `BB2D1` bundle | PASS |
| Preview IPv4, port, instance ID, expiry and server fingerprint | PASS |
| Explicit operator confirmation before pairing | PASS |
| P-256 device key generation | PASS |
| One-time `/v2/pairing/complete` flow | PASS |
| Signed `BB2D-L1 status` required before CONNECTED | PASS |
| Separate Direct profile model | PASS |
| Separate private-key vault | PASS |
| Rename | PASS |
| Signed status | PASS |
| Signed connect verification | PASS |
| Local disconnect without revoke | PASS |
| Signed idempotent revoke | PASS |
| Local delete distinct from revoke | PASS |
| Identity-change warning / fail closed | PASS |
| Multiple independent Direct profiles and keys | PASS |
| Settings migration `4→5` | PASS |
| Backup excludes Direct private keys | PASS |
| Restore without key becomes `NEEDS_REPAIR` | PASS |
| Legacy profiles/tokens/bindings preserved | PASS |
| Direct task/report transport not implemented early | PASS |

## Regression and browser acceptance

Local full extension regression on the user-provided v2.0.0.20 baseline plus Run11 changes: `123/123 PASS`, `0 FAIL`, `0 skipped`.

Tracked Run11 tests cover Direct crypto/lifecycle, UI/permission boundaries and browser Web Crypto. Existing Run10 `BB2D1` parser tests remain unchanged.

Chromium `144.0.7559.96` acceptance passed for real secure-context `crypto.subtle`, real unpacked MV3 service worker, manifest-ordered modular content scripts, real popup runtime and the unpacked final ZIP worker/popup runtime.

Managed Chromium policy was restored byte-for-byte after every accepted browser run. Expected/restored SHA-256: `3b740260e337305aaef268e6c63af8fa2796057ce46f43df5ae5a3949e085e86`.

## Package oracle

Authoritative package: `business-bridge-chatgpt-extension-v2.0.0.21-run11.zip`

Runtime members: `34`

SHA-256: `b9cda4ddffcda3909be7026ada8fd813b0a0faa4c333617852b390da286ed34b`

ZIP integrity, unpack inventory, byte equality, packaged JavaScript syntax and unpacked Chromium load all PASS.

Earlier Run11 package SHAs created before final source-layout modularization are historical only and are not acceptance oracles.

## Scope boundary

Run11 establishes Direct server profile/pairing/lifecycle management only. It does not send `task_create`, poll tasks/reports or perform Direct cancellation. Those operations are frozen scope of `BB2-DIRECT-12-EXT`.

Server code/runtime: unchanged by Run11.
Legacy server: unchanged and not restarted by Run11.
`main`: unchanged.

Marker: `BB2_DIRECT_11_COMPLETE`.
Next: `BB2-DIRECT-12-EXT`.
