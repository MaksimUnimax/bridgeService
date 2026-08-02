# BB2-DIRECT-06 device lifecycle correction

This is a post-acceptance correction triggered by `BB2-DIRECT-11-EXT`. It does not reopen or create a roadmap run. The correction adds only signed `BB2D-L1` paired-device status and idempotent revoke at `POST /v2/pairing/device`.

Version is `0.9.1`; schema stayed `5`. No task/report transport feature was added, no extension code was changed, and no Legacy resource was changed. The endpoint does not create devices, expose secrets, use bearer tokens, or access another device. Replay is TTL-bounded and safe because status is read-only and revoke is idempotent; only the existing `ACTIVE → REVOKED` transition creates the existing audit effect. The canonical browser fixture contains no private key or production value.

Implementation commit: `86ebc50b801dec40f6ec58ce235a50fc4aa07c2d` (parent `874c086182204cb52cfeec6de03c44b289a3cd5b`).

Artifact: `business_bridge_2_direct-0.9.1-py3-none-any.whl`; three deterministic builds matched at `b10d03fc82cbaf591c5c5ce59c5871f778e09e59580d5ec7971b01352cb84a01`. ZIP integrity and `RECORD` validation passed. The staged wheel imported as `business_bridge_direct` from the wheel path, version `0.9.1`, schema `5`, with no repository import substitution.

## Acceptance ledger

- [x] fresh development exact
- [x] fresh main exact
- [x] clean detached worktree
- [x] implementation parent exact
- [x] implementation allowlist
- [x] evidence allowlist
- [x] Legacy pre baseline
- [x] Direct pre baseline
- [x] current identity captured
- [x] schema pre = 5
- [x] request exact field set
- [x] BB2D-L1 exact version
- [x] status action accepted
- [x] revoke action accepted
- [x] UUID validation
- [x] timestamp canonicalization
- [x] <=60s lifetime
- [x] clock-skew validation
- [x] P1363 low-S client signature
- [x] exact client domain transcript
- [x] unknown device generic reject
- [x] invalid signature generic reject
- [x] tampered action reject
- [x] tampered IDs reject
- [x] tampered time reject
- [x] status read-only
- [x] active revoke durable
- [x] revoke idempotent
- [x] status-after-revoke signed REVOKED
- [x] device A cannot act as B
- [x] success exact response field set
- [x] stable instance ID in response
- [x] stable server fingerprint in response
- [x] server P1363 low-S signature
- [x] exact server domain transcript
- [x] tampered response verification reject
- [x] GET rejected
- [x] query rejected
- [x] content type enforced
- [x] chunked rejected
- [x] bounded limits/rate intact
- [x] existing pairing unchanged
- [x] protocol session unchanged
- [x] protocol probe unchanged
- [x] protocol tasks unchanged
- [x] bundle regression unchanged
- [x] schema remains 5
- [x] version 0.9.1
- [x] canonical browser vector tracked
- [x] vector contains no private key
- [x] source full regression PASS
- [x] secret scan PASS
- [x] three builds byte-identical
- [x] wheel RECORD/ZIP PASS
- [x] installed-wheel PASS
- [x] rollback scratch PASS
- [x] production deployment exact artifact
- [x] Direct health 200
- [x] Direct listener exact
- [x] Direct NRestarts stable
- [x] Direct identity unchanged
- [x] public pairing 201
- [x] public signed status ACTIVE
- [x] public signed revoke REVOKED
- [x] public revoke replay idempotent
- [x] public post-revoke status REVOKED
- [x] public tamper reject
- [x] no ACTIVE synthetic acceptance device/session
- [x] Legacy PID/start/NRestarts unchanged
- [x] Legacy health 200
- [x] no Legacy read/mutation
- [x] main unchanged
- [x] exactly two append-only commits
- [x] development published to evidence commit

All gates: `74 PASS`, `0 FAIL`, `0 UNKNOWN`, `0 NOT_RUN`, `0 UNPROVEN`.

## Final service safety

Legacy before/after: PID `1619365`, start `Mon 2026-07-27 13:16:29 MSK`, `NRestarts=0`, active/running, health `200`.

Direct after: PID `2064341`, start `Sun 2026-08-02 08:54:47 MSK`, `NRestarts=0`, active/running, health `200`, version `0.9.1`, schema `5`, listener `78.17.68.165:18100`, instance `73515b73-a4d3-41c7-b143-624ce2a42eb5`, fingerprint `sha256:b0adfb05bd25e9684279494aa8054191dca70784fab416a29ec699b737111bc4`, rotation generation `1`.

No credentials or private keys were printed. Legacy DB/state/secrets were not read. `NEXT_EXPECTED_STEP: BB2-DIRECT-11-EXT` — owner: ChatGPT.
