# BB2-DIRECT-05-FIX7 — instance identity evidence

Status: ACCEPTED / PASS. Marker: `BB2_DIRECT_05_COMPLETE`.

## Repository and build

- Repository: `MaksimUnimax/bridgeService`, branch `development`.
- Base `origin/development`: `cda5c8bebba0d756507b7eae44cd5b0e04c64762`; `main`: `c426263e6dd00135a0023a0fa08a500273e73e23`.
- Existing linear corrective chain: `89f88b3`, `2ea3834`, `225e5bf`, `ec422c2`.
- Python `3.10.12`; full server suite: 29 collected, 29 passed, 0 failed, 0 skipped.
- compileall, manifest, systemd verify, wheel ZIP/RECORD integrity: PASS.
- Tested wheel: `business_bridge_2_direct-0.4.0-py3-none-any.whl`; SHA-256 `5ab039200e396b6557b83593682d928a408fbcdba88b8ae40ea48f9118b472a0`.

## Root cause and deployment

Restrictive umask reproduction proved the package was present and root-importable but failed for the service user with restrictive directory/file modes. Normalization is root-owned, directories `0755`, regular files `0644`, executables `0755`, no service-user write access, and no symlink dereference. Fresh staging and active install imports pass for root and `business-bridge-direct`.

The existing prepared source already required nested metadata. Production was atomically migrated from `/var/lib/business-bridge-2-direct/identity.json` to `/var/lib/business-bridge-2-direct/identity/identity.json`; the old path was removed only after validation. The private key was not replaced. The active venv was replaced atomically after exact-wheel staging; the previous venv remains as Direct-only rollback material.

## Identity and runtime

Public invariants are stable: instance `73515b73-a4d3-41c7-b143-624ce2a42eb5`, fingerprint `sha256:b0adfb05bd25e9684279494aa8054191dca70784fab416a29ec699b737111bc4`, `ECDSA_P256_SHA256`, `SPKI_DER_BASE64URL`, generation `1`. Metadata is root:service-group `0640`; nested directory is root:service-group `0750`; private key is root:service-group `0640`; all are regular files with hardlink count 1. Private content and hash were never printed.

One manual controlled `systemctl restart business-bridge-2-direct.service` was issued. The first post-restart bind exposed a Direct-only TIME_WAIT collision; `allow_reuse_address=True` was corrected, the exact replacement wheel was staged, and the same systemd recovery sequence reached active/running. No second manual restart was issued. Final PID `1683537`, listener exactly `78.17.68.165:18100`, no IPv6/additional listener, version `0.4.0`, and all public endpoints return HTTP 200. The transient retry counter ended at `25` and then stopped increasing.

Bootstrap public-key fingerprint recomputation and public/private correspondence passed without printing private material. Two pinned external `r.jina.ai` edge nodes (`104.26.10.242`, `172.67.70.54`) returned HTTP 200 and the same public instance/fingerprint/version body. Limit, malformed-request, fail-closed identity, symlink/hardlink, mismatch, partial-state and DB tests passed in scratch environments.

## Backup and safety

Fresh Direct-only backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-05-FIX7-20260728T103143Z/`, root:root `0700`. It includes a SQLite backup API copy, identity pair, private key without output, install/config/unit and permitted repository dirty files. Scratch restore validated the backed-up identity pair and SQLite schema. Legacy PID `1619365`, start time `Mon 2026-07-27 13:16:29 MSK`, `NRestarts=0`, listener `127.0.0.1:18083` and health 200 remained unchanged. No legacy secrets, DB, state or logs were read.

Pairing remains deferred to BB2-DIRECT-06; protected protocol to BB2-DIRECT-07; task/report API to BB2-DIRECT-08. Production rotation was not performed.
