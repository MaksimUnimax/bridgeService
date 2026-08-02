# BB2-DIRECT-10-SRV corrected acceptance evidence

TECHNICAL_ID: BB2-DIRECT-10-SRV
ATTEMPT: 5
EXECUTION_MODE: SECURITY_CORRECTION_AND_FULL_REACCEPTANCE

This evidence supersedes rejected BB2-DIRECT-10-SRV attempt-4 acceptance claims. Attempt-4 evidence remains available in Git history and is not rewritten.

## Source and implementation

- Base: `b7ac536edc4e785a491c17e62f752750029abe8f`
- Implementation: `8e128ee252c358aac2da7d8c0cea79ba1686b1e6`
- Implementation parent: `b7ac536edc4e785a491c17e62f752750029abe8f`
- Message: `BB2-DIRECT-10-SRV: correct bundle security and failure handling`
- Changed paths: `server/FILE_MANIFEST.sha256`, `server/src/business_bridge_direct/bundle.py`, `server/src/business_bridge_direct/bundle_cli.py`, `tests/server/test_bundle.py`, `tests/server/test_bundle_cli.py`
- Exactly one implementation commit was created before this evidence.

Corrections remove the OpenSSL/filesystem/environment fallback and use in-memory `cryptography==43.0.3` SPKI validation; add confirmed bounded revoke/status cleanup without silent swallowing; require exact stdout write count and successful flush; and place malformed argparse handling inside the generic JSON error contract.

## Tests and artifact

- Targeted: `18 passed, 45 subtests`.
- Initial source regression: `77 passed, 66 subtests`; four pre-artifact harness failures were rerun with an executable Python 3.10 test interpreter outside `/root`.
- Full installed-wheel regression: `81 passed, 66 subtests`.
- Full command: `python -m pytest -q tests/protocol tests/server` with `PYTHONPATH` set only to the staged exact wheel target and `BB2_WHEEL_UNDER_TEST` set to the exact wheel.
- Compile: `python -m compileall -q server/src/business_bridge_direct` passed.
- Wheel: `business_bridge_2_direct-0.9.0-py3-none-any.whl`; size `36516` bytes.
- Build 1 SHA-256: `83eea1a09dcfad1eea7d4397edb882c6c62a2111ccf94f49b34c87214b269c04`
- Build 2 SHA-256: `83eea1a09dcfad1eea7d4397edb882c6c62a2111ccf94f49b34c87214b269c04`
- Build 3 SHA-256: `83eea1a09dcfad1eea7d4397edb882c6c62a2111ccf94f49b34c87214b269c04`
- Byte-identical: YES.
- Installed-wheel import: service-user import passed; version `0.9.0`; schema `5`; module path was inside staged/installed target.

## Rollback, deployment, and production

Rollback point was created for Direct package state only and restore was rehearsed successfully. A first activation attempt exposed a package permission issue, was rolled back successfully, and the exact wheel was then activated with Direct-only ownership normalization. Final Direct state: PID `2057065`, start `Sun 2026-08-02 07:23:39 MSK`, `NRestarts=0`, `active/running`, health HTTP `200`, version `0.9.0`, schema `5`, listener `78.17.68.165:18100`.

Production purity probe on the installed decoder passed static forbidden-dependency inspection and invalid-DER rejection without external process, temporary file, environment, network, database, or config access by the decoder.

Production bundle/pairing passed with exactly one bundle line, decode validation, initial real Direct HTTP pairing `201`, same one-time credential reuse rejection `403`, device revocation, and no remaining ACTIVE synthetic session. Only a redacted session prefix was recorded: `18334146…`. No code, private key, token, or permanent secret is included here.

## Legacy protection

Legacy before and after were identical: PID `1619365`; start `Mon 2026-07-27 13:16:29 MSK`; `NRestarts=0`; `active/running`; health HTTP `200`. Legacy modified: NO. Legacy restarted: NO.

## Frozen 62-gate ledger

1. PASS — fresh development base exact
2. PASS — fresh main exact
3. PASS — clean detached correction worktree
4. PASS — append-only parent exact
5. PASS — implementation allowlist
6. PASS — evidence allowlist
7. PASS — Legacy PID unchanged
8. PASS — Legacy start time unchanged
9. PASS — Legacy NRestarts unchanged
10. PASS — Legacy active/running
11. PASS — Legacy health 200
12. PASS — no Legacy assets/secrets/state read or copied
13. PASS — Direct target and listener
14. PASS — version 0.9.0
15. PASS — schema 5
16. PASS — decoder has no forbidden imports
17. PASS — decoder has no external process operations
18. PASS — decoder has no filesystem operations
19. PASS — decoder has no environment lookup
20. PASS — decoder has no network/database/config/logging side effect
21. PASS — invalid DER rejected
22. PASS — RSA rejected
23. PASS — wrong EC curve rejected
24. PASS — P-256 accepted
25. PASS — fingerprint mismatch rejected
26. PASS — exact decoded-DER fingerprint
27. PASS — short write rejected
28. PASS — zero write rejected
29. PASS — None write rejected
30. PASS — BrokenPipeError rejected
31. PASS — OSError rejected
32. PASS — flush failure rejected
33. PASS — output failure cleanup confirmed
34. PASS — encode failure cleanup confirmed
35. PASS — self-validation failure cleanup confirmed
36. PASS — transient revoke retry bounded
37. PASS — transient status retry bounded
38. PASS — eventual cleanup success confirmed
39. PASS — cleanup remains failure when ACTIVE
40. PASS — no-command parser contract
41. PASS — unknown-command parser contract
42. PASS — unknown-option parser contract
43. PASS — invalid integer parser contract
44. PASS — missing value parser contract
45. PASS — TTL below range parser contract
46. PASS — TTL above range parser contract
47. PASS — help is non-mutating
48. PASS — existing pairing CLI compatibility
49. PASS — canonical BB2D1 vectors unchanged
50. PASS — successful output is one line
51. PASS — successful session remains ACTIVE before pairing
52. PASS — source server regression
53. PASS — protocol regression
54. PASS — pairing regression
55. PASS — task/report API regression
56. PASS — durable jobs regression
57. PASS — recovery regression
58. PASS — installed-wheel expectations
59. PASS — three builds byte-identical
60. PASS — rollback rehearsal and recovery
61. PASS — final Direct production acceptance
62. PASS — production purity and pairing reuse acceptance

PASS: 62
FAIL: 0
UNKNOWN: 0

This evidence supersedes rejected BB2-DIRECT-10-SRV attempt-4 acceptance claims.
