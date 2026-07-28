# Acceptance matrix BB2-DIRECT-00..18

| Technical ID | Criterion | Method | Evidence | Component | Status | Final marker |
|---|---|---|---|---|---|---|
| BB2-DIRECT-00 | Inventory and safety | Read-only service/network checks | Prior run evidence | Legacy | ACCEPTED / PASS | `BB2_DIRECT_00_READ_ONLY_COMPLETE` |
| BB2-DIRECT-01 | Contract complete and consistent | Markdown/link/secret/consistency scans | `BB2-DIRECT-01_DOCUMENTATION_EVIDENCE.md` | Documentation | ACCEPTED / PASS | `BB2_DIRECT_01_COMPLETE` |
| BB2-DIRECT-02 | Isolated source baseline | Manifest and baseline tests | Deferred run evidence | Source | NOT TESTED | `BB2_DIRECT_02_COMPLETE` |
| BB2-DIRECT-03 | Local Direct service | systemd/health tests | Deferred run evidence | Server | NOT TESTED | `BB2_DIRECT_03_COMPLETE` |
| BB2-DIRECT-04 | Public reachability | External TCP/HTTP and firewall test | Deferred run evidence | Network | NOT TESTED | `BB2_DIRECT_04_COMPLETE` |
| BB2-DIRECT-05 | Stable server identity | Restart/fingerprint test | Deferred run evidence | Server | NOT TESTED | `BB2_DIRECT_05_COMPLETE` |
| BB2-DIRECT-06 | One-time pairing | TTL/reuse/rate/revoke tests | Deferred run evidence | Pairing | NOT TESTED | `BB2_DIRECT_06_COMPLETE` |
| BB2-DIRECT-07 | Encrypted protocol | Vectors/MITM/replay tests | Deferred run evidence | Crypto | NOT TESTED | `BB2_DIRECT_07_COMPLETE` |
| BB2-DIRECT-08 | Task/report compatibility | Create/status/cancel/report tests | Deferred run evidence | API | NOT TESTED | `BB2_DIRECT_08_COMPLETE` |
| BB2-DIRECT-09 | Durable jobs | Restart/idempotency/reconciliation | Deferred run evidence | Runtime | NOT TESTED | `BB2_DIRECT_09_COMPLETE` |
| BB2-DIRECT-10 | Bundle | CLI output/import/checksum/expiry | Deferred run evidence | Installer/extension | NOT TESTED | `BB2_DIRECT_10_COMPLETE` |
| BB2-DIRECT-11 | Extension profiles | Pair/connect/revoke/legacy UI | Deferred run evidence | Extension | NOT TESTED | `BB2_DIRECT_11_COMPLETE` |
| BB2-DIRECT-12 | Direct adapter | Real task/report without tunnel | Deferred run evidence | Extension | NOT TESTED | `BB2_DIRECT_12_COMPLETE` |
| BB2-DIRECT-13 | Isolation | Two server/two conversation test | Deferred run evidence | Extension/server | NOT TESTED | `BB2_DIRECT_13_COMPLETE` |
| BB2-DIRECT-14 | Reconnect | Interruption/backoff/cursor test | Deferred run evidence | Transport | NOT TESTED | `BB2_DIRECT_14_COMPLETE` |
| BB2-DIRECT-15 | Restart recovery | Server/browser restart test | Deferred run evidence | Runtime/extension | NOT TESTED | `BB2_DIRECT_15_COMPLETE` |
| BB2-DIRECT-16 | Installer | Clean install/upgrade/uninstall | Deferred run evidence | Package | NOT TESTED | `BB2_DIRECT_16_COMPLETE` |
| BB2-DIRECT-17 | Security/failure | Full abuse/failure suite | Deferred run evidence | All | NOT TESTED | `BB2_DIRECT_17_COMPLETE` |
| BB2-DIRECT-18 | E2E/release | Clean E2E and release checks | Deferred run evidence | Release | NOT TESTED | `BB2_DIRECT_18_COMPLETE` |
