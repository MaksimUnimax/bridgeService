# BB2-DIRECT-09-SRV acceptance evidence

Technical ID: `BB2-DIRECT-09-SRV`; parent run: `BB2-DIRECT-09`; attempt: `3`; gates frozen: `YES`.

## Defect and correction

Attempt 2 failed during activation because root pip installation created root-only runtime directories/files and did not establish the service group boundary. Root verification passed, but `business-bridge-direct` could not import `business_bridge_direct.identity_cli`; the Direct restart failed. The failed mechanism was `root pip install -> root-only verification -> atomic activation -> restart`.

The corrected mechanism is safe same-filesystem staging, process umask `0027`, complete no-follow inventory, root/service-group ownership and modes, service-user imports and identity verification, then atomic Direct-only activation. The authoritative helper is `normalize_staging_runtime`; it validates the complete tree before mutation, uses `lstat`/`scandir`, rejects hardlinks, devices, FIFOs, sockets and escapes, never follows or mutates symlinks, and preserves interpreter targets.

Rejected candidate: `e94a156688bdb76e20e3d019034005d57e3a20f3`; tree `dfb6cc490c803f5ec3bc1ba57fa807cfdd0bb899`; parent `e41a6c7461e3a852a95da0e2f6cd6423c654b5c4`. Corrected candidate: `46ed6317b03ba9b84e52042cdd068379d02ad1b7`; tree `a6ff1a2ac28f90fb6768c9190e7562cec12eb9a2`; parent exact base. Durable runtime blobs from the rejected candidate were byte-preserved; only deployment, manifest and deployment/regression tests differ.

## Permission evidence

Root-only reproduction (`directories=0700`, `files=0600`, root-owned) failed service-style access before correction and passed after correction. Complete production staging inventory contained `1839` entries, unsafe types `0`, with directories `0750`, non-executable files `0640`, executable interpreter `0750`, owner `root`, group `business-bridge-direct`, and no world-writable entries. Symlink target hash/mode/owner were unchanged. Internal safe links were not traversed; external interpreter target was not mutated. Unsafe symlink, hardlink and FIFO rehearsals failed closed before activation and caused no partial normalization.

The staged service-user probe imported `business_bridge_direct`, `main`, `identity_cli`, `database`, `protocol`, `tasks`, `worker` and `cryptography` entirely from the staging venv; repository imports were absent. Version was `0.8.0`, target schema `5`, and staged `identity_cli verify` passed with the unchanged public identity fingerprint. No private key, pairing code, traffic key, lease token, payload, report body or DB dump was emitted.

## Source, wheel and rollback

Compileall passed. Full server suite passed: `58/58`; protocol pytest passed: `5/5`. Durable checks passed for migration `4->5`, migration rollback, ten-state lifecycle, idempotency, duplicate races, lease ownership/race, stale owner rejection, startup recovery, `RUNNING->UNKNOWN` without blind retry, reconciliation, cancellation, expiry and immutable reports. Permission regression, system-Python boundary, symlink/hardlink/path-escape and secret scans passed. A temporary audit-only executable copy/mode harness was used because the host `/usr/bin/python3.10` was pre-existing `0600`; its exact final mode and SHA-256 were restored and verified.

Three independent clean detached builds were byte-identical: wheel SHA-256 `c9d799d31ad19b34b8340269ef136fdc228e461dfc72641a2dc454a63401563e`; version `0.8.0`; `20` members; RECORD and ZIP integrity passed; installed-wheel imports and durable acceptance passed.

Rollback rehearsal used the verified backup `/var/backups/business-bridge-2-direct/BB2-DIRECT-09-SRV-ATTEMPT3-20260730T104559Z/`: baseline schema `4`, package/config/database restore hashes exact, schema/integrity/FK restored to `4/ok/0`, and unsafe staging prevented activation.

## Production

Verified root-only Direct backup was created before mutation. The new staging tree was on the activation filesystem under `/opt/business-bridge-2-direct`, received deliberate `0600/0700` injection, then passed complete normalization and service-user probes. Atomic directory exchange changed only Direct `.venv`; config changed only Direct `service_version` to `0.8.0`; systemd unit, identity and secrets were unchanged. ExecStartPre passed. Direct activated once and remained stable for five health checks over 15 seconds.

Protected TCP restart acceptance passed: pending task survived with unchanged execution count; duplicate create returned the same task; different payload conflicted; repeated cancel was stable; completed task succeeded once; repeated report retained the same report ID/hash; duplicate execution was not observed. Synthetic device/session was revoked/invalidated; pending tasks, active leases and nonterminal synthetic tasks are `0`; SQLite integrity and FK checks pass. Synthetic staging and inactive package trees were removed.

Final Direct: active/running, PID `1917049`, start `2026-07-30 13:53:09 MSK`, `NRestarts=0`, health `200`, version `0.8.0`, schema `5`, listener `78.17.68.165:18100`, service user/group `business-bridge-direct`, identity unchanged. Final Legacy: PID `1619365`, start `2026-07-27 13:16:29 MSK`, `NRestarts=0`, active/running, listener `127.0.0.1:18083`, health `200`, same PID/start/NRestarts; modified `NO`, restarted `NO`.

Security result: secrets printed `NO`; private keys/pairing codes/traffic keys/raw lease tokens/task payloads/report bodies published `NO`; Legacy secrets/database/state read `NO`; secret scan `PASS`. Previous marker `BB2_DIRECT_08_COMPLETE` present; future marker `BB2_DIRECT_09_COMPLETE` absent. No governance files or future-run markers were changed.

Limitations remain exactly as scoped: real Codex/CLI subprocess execution is outside this run; public reconciliation endpoint remains BB2-DIRECT-14; extension and bundle remain future runs.
