# BB2-DIRECT-06-FIX1 acceptance evidence

Technical ID: `BB2-DIRECT-06-FIX1`  
Status: `ACCEPTED / PASS`  
Marker: `BB2_DIRECT_06_COMPLETE`

## Scope and root cause

The failed 0.5.0 production attempt passed source/staging checks but repeatedly exited after `ExecStartPre` succeeded. The old startup path hid the exception behind a generic `service_failed` event; the migration used a short SQLite lock timeout during a controlled restart. The Direct-only correction keeps startup fail-closed and retries only bounded `database is locked` migration races. The systemd restart policy was not changed.

## Build and tests

- Implementation commit: `bbbc63de129f5ff763672d2084bacf0f892de4c5`.
- Exact wheel: `business_bridge_2_direct-0.5.0-py3-none-any.whl`.
- Wheel SHA-256: `b26ea45ff0239449710bfefc872ccdd9f271eec754ec2d48fbd92473cccbaadd5`.
- Wheel metadata `Version: 0.5.0`, ZIP integrity, complete `RECORD`, no `.pyc` and no runtime/secrets content: PASS.
- Source/wheel/staging/installed suite: `38 passed, 16 subtests passed`.
- `compileall`: PASS. Manifest verification: PASS. `systemd-analyze verify`: PASS.
- Production-shaped installed-wheel migration probe ran under `business-bridge-direct` with real owner/mode and schema 1 database: PASS.

## Production state

- Direct: `0.5.0`, `active/running`, `NRestarts=0`, `78.17.68.165:18100`.
- Final controlled restart changed only the Direct PID; five stability checks remained active/running.
- Public `/v2/health`, `/v2/version`, `/v2/bootstrap` and `/v2/diagnostics/public`: PASS.
- SQLite integrity: `ok`; `PRAGMA user_version=2`; pairing/device/audit tables persisted across restart.
- Server instance identity, fingerprint and rotation generation remained unchanged; private key was checked only as regular file, owner root, mode 0640.

## Pairing acceptance

Real public HTTP checks passed without recording secret values: valid `201` exactly once, reuse `403`, expired `403`, wrong code five times followed by `LOCKED`, malformed request `400`, GET mutation `405`, rate limit `429`. A separate device public identity was created. Device revoke returned `revoked`, repeated revoke returned `already_revoked`. Used, expired and locked sessions plus the revoked device persisted after restart.

Pairing code is random, 32 hex characters, TTL 300–600 seconds, scrypt-salted/verifier-only in SQLite, and never appears in URL, request logs, journal, audit fields, Git or evidence. Device private key is not accepted or stored. Redacted log/journal scans returned zero forbidden-field matches.

External host probes: TCP `18100` 5/5 and HTTP health 5/5. Legacy `127.0.0.1:18083` remained localhost-only and healthy.

## Safety and rollback

Legacy PID `1619365`, start time `Mon 2026-07-27 13:16:29 MSK`, `NRestarts=0`, listener and health remained unchanged before/after deployment and restart. No legacy unit, DB, secrets, config or logs were read or modified.

Pre-mutation root-only backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-06-FIX1-pre-20260728T114412Z/`. It includes the dirty repository snapshot, Direct tree/config/unit, SQLite backup API copy and identity metadata/private-key pair without content output. Rollback is Direct-only to 0.4.0/schema 1/identity.

Next expected run: `BB2-DIRECT-07`; not executed.
