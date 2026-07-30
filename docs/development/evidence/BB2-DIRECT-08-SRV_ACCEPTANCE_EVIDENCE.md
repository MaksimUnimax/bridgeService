# BB2-DIRECT-08-SRV server evidence

All values in this record are redacted to metadata, hashes, counts, statuses,
and shortened synthetic identifiers. No production rows, keys, pairing codes,
payloads, reports, cookies, tokens, or ciphertext are recorded.

- Source base: `8194e3737c679c29363e0cc9e217f71dd2cf28bd`; candidate rejected.
- Direct target: version `0.7.0`, SQLite schema `4`, BB2D-P1 only.
- Wheel: `business_bridge_2_direct-0.7.0-py3-none-any.whl`, ZIP/RECORD/metadata scan PASS; SHA-256 recorded in results JSON.
- Source and installed-package task tests: PASS; critical idempotency/permission regression: 5 consecutive runs PASS.
- Public synthetic flow: pairing/session/create immediate; equivalent reordered duplicate; deterministic conflict; status; repeated report; pending; cancel; repeated cancel; report unavailable; revoke rejection: PASS.
- Direct post-deployment: active/running, listener `78.17.68.165:18100`, health/version/diagnostics HTTP 200, schema 4, integrity `ok`, foreign-key check empty, service-user import/execute PASS.
- Legacy postcheck: PID/start time/NRestarts/listener/health unchanged; `MODIFIED=NO`, `RESTARTED=NO`.
- System Python: package-owned `/usr/bin/python3.10`, mode `0755`, execute PASS; before/after SHA-256 equal; no mutation.

## Defect ledger

- SIGNATURE: Direct ExecStartPre could not execute Python; restart loop after permission normalization.
- ROOT_CAUSE: recursive normalization followed a venv symlink and changed system Python availability.
- OWNER: server deployment mechanism.
- PREVIOUS_MECHANISM: post-install recursive chmod/chown.
- MECHANISM_CHANGED: staging tree with creation-time permissions, explicit allowlist, lstat/no-follow, resolved-root fail-closed checks, hardlink rejection, atomic activation, verification-only traversal.
- WHY_PREVIOUS_TESTS_MISSED: no scratch venv boundary, resolved-path inventory, or system interpreter before/after check.
- REGRESSION: external fake interpreter behind venv-like symlink, path escape, hardlink escape, and interpreter non-mutation tests PASS.
- RESOLVED: production deployment and stable restart acceptance PASS.

## Deferred

Real subprocess/CLI execution, durable crash recovery/reconciliation,
extension/browser implementation, connection bundle, and governance closure
remain outside this server step.
