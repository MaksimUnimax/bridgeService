# BB2-DIRECT-10-SRV Acceptance Evidence

## Scope

- Technical ID: `BB2-DIRECT-10-SRV`
- Parent run: `BB2-DIRECT-10`
- Attempt: `4`
- Execution mode: `ACCEPTANCE_ONLY_CONTINUATION`
- Candidate commit: `c902e10058e1ac76ff5400dd43bc03dfdb3238ff`
- Candidate parent: `17f4ecc87848d75a73dbdf09a3e49b63f037ba62`
- Candidate tree: `69028f505b9af25c2dd3284e167a7c5543666717`

## Process Defect

- Type: `PROCESS`
- Signature: `premature_execution_termination_after_local_candidate`
- Root cause: the phase controller allowed termination after local candidate validation while production, evidence, and publication gates were still pending.
- Previous root-cause model was incomplete because it fixed the contaminated worktree issue, but not the phase-management failure.
- Mechanism replaced: `IMMUTABLE CANDIDATE -> COMPLETE PHASE LEDGER -> FIRST REAL FAILURE OR FULL PASS`
- Status of repeated premature-stop pattern: resolved in this execution by continuing through production, cleanup, and publication preparation.

## Source Of Truth

- Remote development SHA confirmed by SSH `ls-remote`: `17f4ecc87848d75a73dbdf09a3e49b63f037ba62`
- Remote main SHA confirmed by SSH `ls-remote`: `c426263e6dd00135a0023a0fa08a500273e73e23`
- Marker oracle from the exact base commit: `BB2_DIRECT_09_COMPLETE = PRESENT`
- Marker 10 absent at the base and in the run status checks performed here.

## Candidate Verification

- Candidate commit object exists and matches the expected parent and tree.
- Worktree at `/tmp/bb2-direct-10-srv-corrected-wt-20260730-1` was clean when acceptance began.
- Changed paths remained inside the approved implementation allowlist.
- Required base-blob equality was confirmed for the requested non-allowlist paths.
- No source amendment or duplicate implementation commit was created.

## Source And Build Gates

- `python -m compileall -q server/src/business_bridge_direct`: PASS
- `pytest -q tests/protocol tests/server`: PASS
- Source test result: `72 passed, 59 subtests passed`
- Three clean wheel builds from independent clean build directories produced byte-identical artifacts.
- Wheel SHA-256 oracle: `537d8be5f70f882e36ec0c3dd7e75f48356d5e61be114dd543d0bc194d298cc4`
- Wheel filename: `business_bridge_2_direct-0.9.0-py3-none-any.whl`

## Rollback Rehearsal

- A scratch restore was created from the Direct backup and validated without touching the live service.
- Restored scratch service version: `0.8.0`
- Restored scratch schema version: `5`
- Scratch SQLite integrity check: `ok`
- Service-user read access to the restored scratch runtime was verified.
- This confirmed the backup is restorable to the expected `0.8.0/schema 5` baseline.

## Production

- Direct backup was created under `/var/backups/business-bridge-2-direct/BB2-DIRECT-10-SRV-ATTEMPT4-20260730T134112Z`.
- Backup verification passed before activation.
- Direct production was activated to `0.9.0` while preserving schema `5`.
- Live health remained `200` after activation.
- Listener remained on `78.17.68.165:18100`.
- Legacy remained unchanged at `127.0.0.1:18083` with the same PID/start/NRestarts throughout this run.

## Bundle And Pairing

- Production bundle generation succeeded with a one-line stdout response, empty stderr, and strict decoding.
- Fresh bundle session was revoked after capture.
- A live pairing completed successfully for a synthetic device.
- Bundle reuse was rejected on the second use.
- Temporary bundle files and temporary synthetic credentials were cleaned up.
- No plaintext bundle, pairing code, session ID, device ID, or private key was published in this evidence.

## Final Safety

- Direct final state remained active/running at version `0.9.0` with schema `5`.
- Legacy final state remained active/running and unchanged.
- No active synthetic sessions or active synthetic devices remained after cleanup.
- Secret scan remained clean for the accepted scope.

## Publication State

- Pre-push remote recheck passed before publication.
- This evidence was prepared as the single evidence commit for the accepted implementation chain.
- Future extension-parser work remains outside this run and is left to `BB2-DIRECT-10-EXT`.

