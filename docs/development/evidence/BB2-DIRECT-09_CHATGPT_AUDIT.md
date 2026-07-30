# BB2-DIRECT-09 — independent ChatGPT audit

Audit date: `2026-07-30`.

## Scope

This audit independently reviewed the published GitHub commit chain, changed paths, durable runtime implementation, deployment permission correction and redacted acceptance evidence for `BB2-DIRECT-09-SRV`.

The accepted linear chain is:

- base: `e41a6c7461e3a852a95da0e2f6cd6423c654b5c4`;
- implementation: `46ed6317b03ba9b84e52042cdd068379d02ad1b7`;
- evidence: `168f80f3f9b3c3dcd27219c5f93aa15a2bb10236`.

`main` remained `c426263e6dd00135a0023a0fa08a500273e73e23`.

## Source and architecture review

The implementation advances Direct to version `0.8.0` and SQLite schema `5`. It adds the approved durable states `CREATED`, `QUEUED`, `ACCEPTED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`, `UNKNOWN` and `EXPIRED`; immutable operation mapping; durable transition history; lease owner/token-hash checks; startup recovery; internal reconciliation; durable reports; cancellation and expiry.

`RUNNING` without a durable result is recovered as `UNKNOWN` and is not automatically requeued. Reconciliation is internal and proof-gated; no public reconciliation endpoint was added. The worker remains an in-process deterministic adapter and does not execute a subprocess or shell.

The attempt-2 production activation defect was correctly isolated to the installed-runtime permission boundary. The corrected deployment helper performs complete no-follow staging inventory, rejects unsafe types, hardlinks and path escapes, preserves interpreter symlink targets, establishes root/service-group ownership and safe modes, and requires service-user imports plus staged identity verification before activation.

## Acceptance evidence reviewed

Published evidence records:

- server tests: `58/58 PASS`;
- protocol tests: `5/5 PASS`;
- migration `4→5`, rollback and data/report preservation: `PASS`;
- state-machine, idempotency, duplicate races, lease race, stale-owner rejection, recovery, no-blind-retry, reconciliation, cancellation, expiry and durable reports: `PASS`;
- three byte-identical wheels with SHA-256 `c9d799d31ad19b34b8340269ef136fdc228e461dfc72641a2dc454a63401563e`;
- installed-wheel and protected TCP acceptance: `PASS`;
- isolated rollback rehearsal and unsafe-staging rejection: `PASS`;
- production pre-activation service-user imports and `identity_cli verify`: `PASS`;
- production restart acceptance, duplicate protection, immutable repeated report and synthetic cleanup: `PASS`.

Final published runtime evidence records Direct active/running at `0.8.0/schema 5`, health `200`, listener `78.17.68.165:18100`, stable `NRestarts=0`, unchanged identity, service user/group and system Python. Legacy remained on PID `1619365`, health `200`, unchanged PID/start/NRestarts, `MODIFIED=NO`, `RESTARTED=NO`.

## Security and scope

The published source/evidence paths are limited to server runtime, server/protocol tests and the three approved run-09 evidence files. No extension, installer, governance marker, `main`, Legacy source/runtime, private key, pairing code, traffic key, raw lease token, task payload, report body or database dump was published.

No Chromium gate is required for this run because browser code, canonicalization and `BB2D-P1` cryptographic primitives were not changed.

The following remain intentionally outside this run:

- real Codex/CLI subprocess execution;
- public reconnect/reconciliation endpoint (`BB2-DIRECT-14`);
- connection bundle and extension work (`BB2-DIRECT-10+`).

## Verdict

`BB2-DIRECT-09 = ACCEPTED / PASS`.

The implementation and evidence satisfy the approved durable-jobs-and-recovery scope. Governance documentation may be updated and marker `BB2_DIRECT_09_COMPLETE` may be recorded. The next roadmap run is `BB2-DIRECT-10`.
