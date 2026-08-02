# BB2-DIRECT-06 Device Lifecycle Attempt 6 Evidence

- TECHNICAL_ID: BB2-DIRECT-06
- PARENT_RUN: BB2-DIRECT-06
- ATTEMPT: 6
- RESULT: PASS pending publication gate 104
- BASE: origin/development = 130182ed257e32af7391197cc32102572517f2cc
- MAIN: origin/main = c426263e6dd00135a0023a0fa08a500273e73e23
- EXISTING_LOCAL_HEAD: 962c5b251e1b3aec192d8e1ce8a2da792bb5c787 (informational; not used)
- NEW_DETACHED_WORKTREE: /tmp/bb2-direct-06-attempt6-candidate-EU9GeL
- TEST_ORACLE_COMMIT: c8a1be6d7abc76c51d688cec1a6be50956f4177f
- TEST_ORACLE_PARENT: 130182ed257e32af7391197cc32102572517f2cc
- TEST_ORACLE_CHANGED_PATHS: tests/server/test_device_lifecycle_matrix.py only
- RUNTIME_CHANGED: NO; server tree byte-identical to 87fa5e4854184aef97759dc59cc245eb04fdb30e
- COLLECTED_NODES: 69; EXECUTED_NODES: 69 PASS
- SEMANTIC_VALIDATOR: PASS (G019, G020, G030, G035, G074, G076, G078)
- FULL_SOURCE_REGRESSION: 159 passed, 66 subtests
- BUILD1_SHA / BUILD2_SHA / BUILD3_SHA: 8036267f3a9fc6254ba9f713489d6d52f9f22959cade6d3f1779faafce934c30
- INSTALLED_WHEEL: staged origin verified; 159 passed, 66 subtests
- PRODUCTION_RUNTIME: member hashes match corrected candidate; redeploy NO; restart NO
- DIRECT: PID 2066643; start Sun 2026-08-02 09:14:33 MSK; NRestarts 0; active/running; health 200; version 0.9.1; listener 78.17.68.165:18100; instance 73515b73-a4d3-41c7-b143-624ce2a42eb5; rotation 1
- PUBLIC_LIFECYCLE: pairing 201; status ACTIVE; revoke; exact replay; fresh revoke; status REVOKED; wrong signature; expired-within-skew; tamper action; cleanup all PASS
- LEGACY: PID 1619365; start Mon 2026-07-27 13:16:29 MSK; NRestarts 0; active/running; health 200; MODIFIED NO; RESTARTED NO
- ATTEMPT2: REJECTED
- ATTEMPT3: FAILED_ACCEPTANCE_INCOMPLETE
- ATTEMPT4: FAILED_PROCESS_ORACLE_AND_PROOF_REFERENCE_VALIDATION
- ATTEMPT4_PASS_FIELDS: HISTORICAL_REJECTED_EVIDENCE
- ATTEMPT5: BLOCKED_BY_LOCAL_HEAD_MISCLASSIFICATION_WITHOUT_EXECUTION

The authoritative gate ledger is embedded in the companion JSON. Gate 104 becomes PASS only after the exact two-commit publication is verified.

