# Acceptance matrix BB2-DIRECT-00..18

| Technical ID | Criterion | Method | Evidence | Component | Status | Final marker |
|---|---|---|---|---|---|---|
| BB2-DIRECT-00 | Inventory and safety | Read-only service/network checks | Prior run evidence | Legacy | ACCEPTED / PASS | `BB2_DIRECT_00_READ_ONLY_COMPLETE` |
| BB2-DIRECT-01 | Contract complete and consistent | Markdown/link/secret/consistency scans | `BB2-DIRECT-01_DOCUMENTATION_EVIDENCE.md` | Documentation | ACCEPTED / PASS | `BB2_DIRECT_01_COMPLETE` |
| BB2-DIRECT-02 | Isolated source baseline | Manifest, package-install and baseline tests | `docs/development/evidence/BB2-DIRECT-02_SOURCE_BASELINE_EVIDENCE.md` | Source | ACCEPTED / PASS | `BB2_DIRECT_02_COMPLETE` |
| BB2-DIRECT-03 | Local Direct service | systemd/health tests | `docs/development/evidence/BB2-DIRECT-03_LOCAL_SERVICE_EVIDENCE.md` | Server | ACCEPTED / PASS | `BB2_DIRECT_03_COMPLETE` |
| BB2-DIRECT-04 | Public reachability | External TCP/HTTP and firewall test | `BB2-DIRECT-04_PUBLIC_REACHABILITY_EVIDENCE.md` | Network | ACCEPTED / PASS | `BB2_DIRECT_04_COMPLETE` |
| BB2-DIRECT-05 | Stable server identity | Restart/fingerprint test | `BB2-DIRECT-05_INSTANCE_IDENTITY_EVIDENCE.md` | Server | ACCEPTED / PASS | `BB2_DIRECT_05_COMPLETE` |
| BB2-DIRECT-06 | One-time pairing | TTL/reuse/rate/revoke, restart and production HTTP tests | `BB2-DIRECT-06_ACCEPTANCE_EVIDENCE.md` | Pairing | ACCEPTED / PASS | `BB2_DIRECT_06_COMPLETE` |
| BB2-DIRECT-07 | Encrypted protocol | Redacted vectors, real Chrome Web Crypto, GCM framing, replay/tamper and production checks | `BB2-DIRECT-07_FIX2_ACCEPTANCE_EVIDENCE.md` | Crypto | ACCEPTED / PASS | `BB2_DIRECT_07_COMPLETE` |
| BB2-DIRECT-08 | Task/report compatibility | Source, installed-wheel and production create/status/cancel/report; duplicate/conflict; protected errors; independent Chromium Web Crypto | `BB2-DIRECT-08-SRV_ACCEPTANCE_EVIDENCE.md`, `BB2-DIRECT-08_CHATGPT_CHROMIUM_EVIDENCE.md` | API | ACCEPTED / PASS | `BB2_DIRECT_08_COMPLETE` |
| BB2-DIRECT-09 | Durable jobs | Migration, state machine, idempotency, leases, restart recovery, reconciliation, installed-wheel and production restart acceptance | `BB2-DIRECT-09-SRV_ACCEPTANCE_EVIDENCE.md`, `BB2-DIRECT-09-SRV_RESULTS.json`, `BB2-DIRECT-09-SRV_RECOVERY_RESULTS.json`, `BB2-DIRECT-09_CHATGPT_AUDIT.md` | Runtime | ACCEPTED / PASS | `BB2_DIRECT_09_COMPLETE` |
| BB2-DIRECT-10 | Bundle | CLI output/import/checksum/expiry | Deferred run evidence | Installer/extension | NOT TESTED | `BB2_DIRECT_10_COMPLETE` |
| BB2-DIRECT-11 | Extension profiles | Pair/connect/revoke/legacy UI | Deferred run evidence | Extension | NOT TESTED | `BB2_DIRECT_11_COMPLETE` |
| BB2-DIRECT-12 | Direct adapter | Real task/report without tunnel | Deferred run evidence | Extension | NOT TESTED | `BB2_DIRECT_12_COMPLETE` |
| BB2-DIRECT-13 | Isolation | Two server/two conversation test | Deferred run evidence | Extension/server | NOT TESTED | `BB2_DIRECT_13_COMPLETE` |
| BB2-DIRECT-14 | Reconnect | Interruption/backoff/cursor test | Deferred run evidence | Transport | NOT TESTED | `BB2_DIRECT_14_COMPLETE` |
| BB2-DIRECT-15 | Restart recovery | Server/browser restart test | Deferred run evidence | Runtime/extension | NOT TESTED | `BB2_DIRECT_15_COMPLETE` |
| BB2-DIRECT-16 | Installer | Clean install/upgrade/uninstall | Deferred run evidence | Package | NOT TESTED | `BB2_DIRECT_16_COMPLETE` |
| BB2-DIRECT-17 | Security/failure | Full abuse/failure suite | Deferred run evidence | All | NOT TESTED | `BB2_DIRECT_17_COMPLETE` |
| BB2-DIRECT-18 | E2E/release | Clean E2E and release checks | Deferred run evidence | Release | NOT TESTED | `BB2_DIRECT_18_COMPLETE` |

## BB2-DIRECT-07

PASS: `BB2D-P1` is the sole protected application protocol. Session and probe interoperability were accepted with real Chrome Web Crypto, including the exact combined AES-GCM `ciphertext||tag` boundary.

## BB2-DIRECT-08

PASS: Direct `0.7.0`, schema `4`, implements protected task create/status/cancel/report operations, immutable operation IDs, canonical idempotency, deterministic payload conflict and repeatable reports. Source, installed-wheel, rollback and production acceptance passed. Pre-authentication failures return strict generic non-sensitive JSON; authenticated application failures return signed/encrypted status-bound `task_error` envelopes. Independent Chromium `globalThis.crypto.subtle` verification passed 6/6 runs against the published canonical, AAD and domain-separation vectors.

## BB2-DIRECT-09

PASS: Direct `0.8.0`, schema `5`, implements the ten-state durable lifecycle, immutable operation ledger, one-winner lease ownership, stale-owner rejection, startup recovery, `RUNNING→UNKNOWN` ambiguity without blind retry, internal proof-gated reconciliation, cancellation, expiry and immutable durable reports. Source, protocol, installed-wheel, rollback and production restart acceptance passed. Complete no-follow staging permission normalization and service-user import/identity probes corrected the attempt-2 activation defect. Legacy remained unchanged and `main` was not modified.
