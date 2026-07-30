# BB2-DIRECT-08 — independent Chromium/Web Crypto evidence

Technical ID: `BB2-DIRECT-08-SRV`

Governance owner: ChatGPT

Verification date: `2026-07-30`

## Published inputs

- Published development head before governance: `92f622cbda5103c918af430b32c49f9d7762b44a`.
- Server implementation commit: `ba9614dcd722fd77bf118f78427737f85bed2f6c`.
- Server evidence commit: `92f622cbda5103c918af430b32c49f9d7762b44a`.
- Published browser-vector blob: `fde3d96defabc543b8ff53427c90f41ea26430ec`.
- Published browser-vector SHA-256: `a79ed27626ec3730bacfdee4edbdb803fa53e7bf72647d8d0a3c60e547ddda9e`.
- Published browser module blob: `e139f45298b81550c2b3143faed674b704c1e0f4`.

The inputs contain synthetic public values only. No production private key, pairing code, traffic key, ciphertext, task payload, report, token or database row was used.

## Runtime

- Chromium: `144.0.7559.96`.
- JavaScript runtime available for harness preparation: Node.js `22.16.0`.
- Browser execution used a secure localhost context.
- Cryptographic implementation: real `globalThis.crypto.subtle` inside Chromium.
- Independent repeated runs: `6`.

## Published-vector checks

Each of the six runs independently verified 15 published vector groups:

1. `task_create` canonicalization and SHA-256;
2. `task_status` canonicalization and SHA-256;
3. `task_cancel` canonicalization and SHA-256;
4. `task_report` canonicalization and SHA-256;
5. successful `task_response` canonicalization and SHA-256;
6. `operation_payload_conflict` canonicalization and SHA-256;
7. `task_not_found` canonicalization and SHA-256;
8. `not_cancellable` canonicalization and SHA-256;
9. `report_not_available` canonicalization and SHA-256;
10. client-to-server task AAD canonicalization and SHA-256;
11. server-to-client status-200 AAD canonicalization and SHA-256;
12. server-to-client status-400 AAD canonicalization and SHA-256;
13. server-to-client status-404 AAD canonicalization and SHA-256;
14. `BB2D-P1/client-tasks` domain-separated transcript length and SHA-256;
15. `BB2D-P1/server-tasks` domain-separated transcript length and SHA-256.

Field sets, canonical byte lengths and strict base64url round trips were also checked.

## Real Web Crypto operations

Each run additionally executed:

- ECDSA P-256 key generation;
- low-S 64-byte signature production through the published browser module;
- ECDSA verification;
- rejection of a modified signed message;
- two-party ephemeral ECDH P-256 and equal shared-secret verification;
- HKDF-SHA-256 derivation of 512 bits;
- AES-256-GCM encryption with AAD;
- combined `ciphertext||tag` length verification;
- split/join verification for the 16-byte GCM tag;
- AES-256-GCM decryption;
- rejection of modified ciphertext.

## Result

- Chromium runs: `6/6 PASS`.
- `globalThis.crypto.subtle`: present in every run.
- Secure context: true in every run.
- Published vector groups per run: `15/15 PASS`.
- Cryptographic operation set per run: PASS.
- Local redacted result JSON SHA-256: `4e67dc42ad58326929a9a5588b7d2af49fa3310ecb69d91fc42c6355d8319980`.
- Production server mutation: `NO`.
- Legacy Bridge access or mutation: `NO`.
- Secrets present in evidence: `NO`.

Verdict: `PASS`.
