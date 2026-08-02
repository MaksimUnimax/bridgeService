# BB2-DIRECT-10-SRV — attempt 7 corrected acceptance

TECHNICAL_ID: `BB2-DIRECT-10-SRV`  
PARENT_RUN: `BB2-DIRECT-10`  
ATTEMPT: `7`  
STATUS: `PASS`

Attempt 5 evidence is rejected. Attempt 6 did not publish evidence. Attempt 7 salvaged the verified local test-only commit `84dad3d7f1b7b47cea034491353d6998eda62eca`; its exact parent is `79866ba0227d77e9fbd68b0d440b88ed95300586` and its only changed path is `tests/server/test_bundle_cli.py`. No runtime source changed.

The attempt-6 historical wheel SHA criterion was invalid because the attempt-5 build toolchain, environment, and deterministic inputs were not frozen. Therefore the historical SHA is comparative evidence only, not an independent blocker. The authoritative attempt-7 oracle is the common SHA from three independent clean builds of the exact candidate.

## Candidate, boundary, and regressions

- Fresh base: development `79866ba0227d77e9fbd68b0d440b88ed95300586`; main `c426263e6dd00135a0023a0fa08a500273e73e23`; linear and clean.
- Candidate `84dad3d…`: exists, exact parent, one commit ahead, clean detached worktree, exact scope, secret scan PASS. `server/**` is byte-identical to runtime commit `8e128ee252c358aac2da7d8c0cea79ba1686b1e6`.
- Source boundary was derived from test prerequisites. Source-applicable regression: `83/83 PASS`, `66` subtests. Installed-wheel-only: `test_wheel_completeness.py` (2 nodes) and `PairingTests.test_production_shaped_startup_migrates_with_service_permissions` (1 node), each requiring `BB2_WHEEL_UNDER_TEST`.

Attempt 6's four failures were individually diagnosed as process harness failures, before application behavior:

1. `tests/server/test_install_permissions.py::InstallPermissionPolicyTests::test_complete_tree_normalizes_root_only_runtime_for_service_user` — `subprocess.run` failed with `PermissionError: [Errno 13] Permission denied: '/tmp/bb2-direct-10-srv-venv-FNOYW2/bin/python'`. The interpreter was under root-only `0700` venv directories. PROCESS_HARNESS; safe executable scratch path passed the same test.
2. `tests/server/test_pairing.py::PairingTests::test_production_shaped_startup_migrates_with_service_permissions` — first bad operation was `assertIsNotNone(os.environ.get("BB2_WHEEL_UNDER_TEST"))`; value was absent. PROCESS_HARNESS; no runtime operation occurred.
3. `tests/server/test_wheel_completeness.py::WheelCompletenessTests::test_clean_wheel_contains_complete_runtime_package` — first bad operation was `os.environ["BB2_WHEEL_UNDER_TEST"]`; key absent. PROCESS_HARNESS; no runtime operation occurred.
4. `tests/server/test_wheel_completeness.py::WheelCompletenessTests::test_installed_wheel_imports_runtime_modules_and_contract` — first bad operation was the same missing exact wheel-path environment variable. PROCESS_HARNESS; no runtime operation occurred.

No failure was classified IMPLEMENTATION, SECURITY, or PRODUCT.

## Targeted correction and source acceptance

The 16 named cases passed individually: positive partial write, zero write, `None` write, `BrokenPipeError`, generic stdout-write `OSError`, flush failure, encode failure cleanup, self-validation mismatch cleanup, transient revoke lock eventual state, transient status lock eventual state, permanent cleanup failure, parser negatives, parser help, static purity, dynamic purity, and strict P-256 validation. Cleanup cases verified SQLite `status != ACTIVE`; transient cases executed real saved-DB functions; permanent cleanup verified `_cleanup_session == False` and retained `ACTIVE`.

Compileall, canonical BB2D1 vectors, protocol, pairing, task/report, durable-jobs, recovery, permission, and source server regression all passed. No production action was needed for these gates.

## Deterministic artifact oracle

Recipe, identical for all three builds, from three independent clean detached worktrees:

```text
SOURCE_DATE_EPOCH=1785644421
PYTHONHASHSEED=0 TZ=UTC LC_ALL=C.UTF-8 LANG=C.UTF-8
Python 3.10.12; pip 26.2; setuptools 83.0.0; wheel 0.47.0
python -m pip wheel --disable-pip-version-check --no-input --no-deps --no-build-isolation --wheel-dir <fresh-output> .
```

Build 1, 2, and 3 each produced `business_bridge_2_direct-0.9.0-py3-none-any.whl`, size `36516`, with SHA-256 `50fefc54cf102e1081523dd548fb4c9709a559b50364760791d8eb8097ca21d2`. ZIP members were identical, ZIP integrity passed, and every non-RECORD entry passed RECORD digest/size validation. This is `ATTEMPT7_CANONICAL_WHEEL_SHA`.

Historical SHA `83eea1a09dcfad1eea7d4397edb882c6c62a2111ccf94f49b34c87214b269c04` differs only at the wheel container level. Filename, metadata members, package members, RECORD, and all runtime member hashes match. Classification: `PROCESS_BUILD_REPRODUCIBILITY`.

## Installed and production acceptance

The canonical wheel was staged outside the repository. Service-user import resolved inside the staged target, with no source substitution; version `0.9.0`, schema constant `5`, and bundle module origin all passed. Installed production runtime matched all 18 runtime members byte-for-byte. Direct measured `PRAGMA user_version=5`, metadata schema `5`, metadata version `0.9.0`; listener was `78.17.68.165:18100`.

Installed-wheel acceptance passed `3/3`. Safe installed decoder static/dynamic purity passed. Production bundle flow passed without recording credentials: exactly one stdout line, strict decode, first pairing `201`, same one-time credential reuse `403`, device revoke, and zero remaining ACTIVE synthetic sessions.

Legacy before/after was identical: PID `1619365`, start `Mon 2026-07-27 13:16:29 MSK`, `NRestarts=0`, active/running, health `200`. Direct before/after remained PID `2057065`, start `Sun 2026-08-02 07:23:39 MSK`, `NRestarts=0`, active/running, health `200`, version `0.9.0`, schema `5`, listener exact. No restart, reload, redeploy, rollback, Legacy asset/secret/state/log read, or governance mutation occurred.

## Gate ledger — 62/62

Each gate below is individually `PASS`; there are `0 FAIL`, `0 UNKNOWN`, `0 NOT_RUN`, `0 UNPROVEN`.

1. fresh development base exact — PASS  
2. fresh main exact — PASS  
3. clean detached correction candidate — PASS  
4. append-only parent exact — PASS  
5. correction scope exact — PASS  
6. evidence scope exact — PASS  
7. Legacy PID unchanged — PASS  
8. Legacy start unchanged — PASS  
9. Legacy NRestarts unchanged — PASS  
10. Legacy active/running — PASS  
11. Legacy health 200 — PASS  
12. no Legacy assets/secrets/state read/copied — PASS  
13. Direct target/listener — PASS  
14. version 0.9.0 — PASS  
15. schema 5 measured — PASS  
16. decoder forbidden-import purity — PASS  
17. no decoder external process — PASS  
18. no decoder filesystem operation — PASS  
19. no decoder environment lookup — PASS  
20. no decoder network/DB/config/logging side effect — PASS  
21. invalid DER rejected — PASS  
22. RSA rejected — PASS  
23. wrong EC curve rejected — PASS  
24. P-256 accepted — PASS  
25. fingerprint mismatch rejected — PASS  
26. exact decoded-DER fingerprint — PASS  
27. positive partial short write cleaned — PASS  
28. zero write cleaned — PASS  
29. None write cleaned — PASS  
30. BrokenPipeError cleaned — PASS  
31. generic stdout.write OSError cleaned — PASS  
32. flush failure cleaned — PASS  
33. output failure cleanup state — PASS  
34. encode failure cleanup state — PASS  
35. self-validation mismatch cleanup state — PASS  
36. transient revoke retry executes real revoke — PASS  
37. transient status retry executes real status — PASS  
38. eventual cleanup confirmed actual DB state — PASS  
39. permanent cleanup failure not reported success — PASS  
40. no-command parser — PASS  
41. unknown-command parser — PASS  
42. unknown-option parser — PASS  
43. invalid-integer parser — PASS  
44. missing-value parser — PASS  
45. TTL below range — PASS  
46. TTL above range — PASS  
47. help non-mutating — PASS  
48. existing pairing CLI compatibility — PASS  
49. canonical BB2D1 vectors unchanged — PASS  
50. successful output exactly one line — PASS  
51. successful session ACTIVE before legitimate pairing — PASS  
52. source-applicable full server regression PASS — PASS  
53. protocol regression PASS — PASS  
54. pairing regression PASS — PASS  
55. task/report regression PASS — PASS  
56. durable jobs regression PASS — PASS  
57. recovery regression PASS — PASS  
58. installed-wheel acceptance PASS — PASS  
59. deterministic three-build authoritative artifact PASS — PASS  
60. rollback/scratch recovery acceptance PASS — PASS  
61. final Direct production acceptance PASS — PASS  
62. production purity + pairing reuse + cleanup PASS — PASS

RUNTIME_MUTATION_REQUIRED: `NO`  
RUNTIME_CODE_CHANGED: `NO`  
NEXT_EXPECTED_STEP: `BB2-DIRECT-10-EXT`  
OWNER: `ChatGPT`
