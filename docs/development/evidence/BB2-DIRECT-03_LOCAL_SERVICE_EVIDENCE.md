# BB2-DIRECT-03 local service evidence

Date: 2026-07-28 (MSK). Technical ID: `BB2-DIRECT-03`.

## Result

Accepted PASS. Implementation commits are `89575d777a1a02b06ece95c6ed85f0711e6ec786` and `e9bee7bb1d8017cd42d480e940bafb6a61a41f61`; final evidence commit follows. Remote `development` was pushed linearly with the project-specific key via SSH-over-443; `main` stayed `c426263e6dd00135a0023a0fa08a500273e73e23`.

## Runtime

- Distribution/import/version: `business-bridge-2-direct` / `business_bridge_direct` / `0.2.0`.
- User/group: `business-bridge-direct` / `business-bridge-direct`, UID/GID 995, shell `/usr/sbin/nologin`, locked password, only its own primary group.
- Unit: enabled, active/running, `Restart=on-failure`, `RestartSec=2s`, `NoNewPrivileges`, private tmp/devices, strict system/config read-only boundaries, empty capability bounding set, TasksMax 64 and LimitNOFILE 1024.
- MainPID after final restart test: 1661953; executable is `/opt/business-bridge-2-direct/.venv/bin/python`; command is the Direct module with the Direct config path.
- Listener: only `127.0.0.1:18100`; no wildcard or public Direct bind.

## Endpoints

`GET /v2/health` → 200: `{"status":"ok","service":"business-bridge-2-direct","version":"0.2.0"}`

`GET /v2/version` → 200: `{"service":"business-bridge-2-direct","version":"0.2.0","api_version":"v2","transport":"localhost-http"}`

`GET /v2/diagnostics/public` → 200: `{"service":"business-bridge-2-direct","version":"0.2.0","status":"ready","listener_scope":"localhost","database":"ready","identity":"not_configured","pairing":"disabled","crypto":"disabled","tasks":"disabled"}`

Unknown route returned 404; unsupported POST returned 405. Responses included JSON content type, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and no Python version.

## Database and permissions

Database `/var/lib/business-bridge-2-direct/bridge.sqlite3` is a regular 0600 file owned by `business-bridge-direct:business-bridge-direct`; it has `user_version=1` and only table `runtime_metadata`, with keys `schema_version` and `service_version`. Initialization was idempotent. It is not a symlink or legacy hardlink; legacy DB content was not read. Config is root:Direct 0640, config/secrets/install are root:Direct 0750, state/database/log are Direct:Direct 0750/0600/0750, unit is root:root 0644, and secrets is empty.

## Tests and safety

Repository, staging and final installed command:

`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=... python3 -m unittest discover -s tests/server -p 'test_*.py' -v`

Result: 13 collected, 13 passed, 0 failed, 0 skipped. Manifest verification, package metadata/source-install comparison, systemd verification, redaction scans and final endpoint scans passed. Runtime source uses only Python 3.10 standard library and no subprocess, legacy package, legacy path, token or key material.

Exactly one controlled Direct SIGKILL restart test was run: PID 1661755 → 1661953, NRestarts 20 → 24, active/running and health recovered, DB schema persisted, no duplicate DB was created. Legacy before/after: PID 1619365; ActiveEnterTimestamp `Mon 2026-07-27 13:16:29 MSK`; NRestarts 0; active/running; health 200; listener `127.0.0.1:18083`; `MODIFIED=NO`, `RESTARTED=NO`.

Backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-03-20260728T063226Z`, root:root 0700, containing the pre-run Direct tree, metadata, SHA-256 manifest and rollback marker for original version 0.1.0. No legacy content was included or published.

## Deferred scope

Localhost-only diagnostic service. Public bind/firewall/external reachability, identity/keypair, pairing, application crypto, jobs/reports and extension transport remain deferred to later runs. `BB2-DIRECT-04` is next and was not executed.

Marker: `BB2_DIRECT_03_COMPLETE`.
