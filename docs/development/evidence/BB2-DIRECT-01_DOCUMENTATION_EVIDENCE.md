# BB2-DIRECT-01 documentation evidence

## Scope

Изменены только Markdown-документы и repository metadata. Server runtime, systemd, user, port, firewall, legacy paths, DB, secrets, state и logs не изменялись.

## Files, sizes and SHA-256

| Path | State | Bytes | SHA-256 |
|---|---|---:|---|
| `README.md` | UPDATED | 2736 | `3f2b4838cb4149e364393a86995935956b8056cfd5ff851852e811bf0d28409e` |
| `docs/product/PRODUCT_DESCRIPTION.md` | CREATED | 5120 | `25c1ab55e85bf1ce714e96f6f5885136f0c5a303be76279a36df63baa67c3a86` |
| `docs/product/FULL_TECHNICAL_SPEC.md` | CREATED | 7215 | `d27587a0335f4afac530c93581f89a0ddf0e9dc7ca6339930996f81e101b0e24` |
| `docs/product/ROADMAP.md` | CREATED | 4334 | `f6b9475d490e9f9994a3aebc99ffa07aa39da6fde7ad906c4518672958a83176` |
| `docs/architecture/ARCHITECTURE.md` | CREATED | 2935 | `e6d177fca316b589ba1b023d44c772a905a1756f7be19e3cdd65b4da44b92276` |
| `docs/architecture/COMPATIBILITY_CONTRACT.md` | CREATED | 1449 | `bdca4b3c5b1ea57762fabce3537bceec8183ea887a36ae51b3e2ea412e54fd0a` |
| `docs/architecture/API_COMPATIBILITY_MATRIX.md` | CREATED | 3075 | `165b623e570868fbce72adb94c4c35ba5b42e3daddc8ad0fd5a7cf3835b63c3c` |
| `docs/architecture/SECURITY_MODEL.md` | CREATED | 2672 | `7b92e007cbbdb9db9cb3699ac3cd707a09281b155595ce3b0dfa8b55659e9ab7` |
| `docs/architecture/ACCEPTANCE_MATRIX.md` | CREATED | 2961 | `72f4034577eb08e52a63928029eec70e7b1ad770d00ef852e38201adf7643cf4` |
| `docs/architecture/ROLLBACK_PLAN.md` | CREATED | 1570 | `b370ae548f5bce456019daf22f00b6d1067b33812d793da3f507379554d1402a` |
| `docs/adr/ADR-001-DIRECT-TRANSPORT.md` | CREATED | 710 | `ad17840b0b148df8beccbec81c67ab22f2748c02cfd72c475175f6c14c5099c0` |
| `docs/adr/ADR-002-APPLICATION-LAYER-CRYPTO.md` | CREATED | 766 | `bd5629c6c936eb0af8d33026fac917c6e7661e67cc4abae0fc6f8adf0b507fe0` |
| `docs/adr/ADR-003-PAIRING-AND-DEVICE-IDENTITY.md` | CREATED | 878 | `78cde153a738412cde6dc92f0316395607b68557f859a6dddb639f6aec80812e` |
| `docs/development/MASTER_CONTEXT_PROMPT.md` | UPDATED | 13055 | `fd5f45174fc69a468cc908e806f4544f24fa505461e94b5f2856839393775fd6` |
| `docs/development/RUN_STATUS.md` | UPDATED | 2717 | `877f538dbdd246edbd4f28bc1806b9568bf1aaaa2f3ed6f4bb2cd24e10214d75` |
| `docs/development/WORKLOG.md` | UPDATED | 5081 | `69ba239b0389b18ac64cd3d572d866d493eb22715658b4d9f450933f71714d21` |

Evidence file hash is reported after final file assembly. The published commit SHA is recorded in the final evidence follow-up commit.

## Checks

- Required files present and non-empty: PASS (17 mandatory repository documents).
- Markdown internal links: PASS; all local targets exist.
- Placeholder scan: PASS; no forbidden placeholder terms. Allowed markers used only where applicable: `NOT TESTED`, `NEEDS_SOURCE_CONFIRMATION`, `DEFERRED`.
- Secret scan: PASS; no private-key blocks, bearer values, Authorization values, passwords, cookies, real pairing codes, `.env` content or SSH private keys.
- Terminology consistency: PASS; client-owned VPS, no relay/tunnel, public IPv4, non-mandatory domain, CLI-issued bundle, application-layer protection, isolated Direct resources and legacy fallback are consistent.
- Cross-document consistency: PASS; paths, port, pairing, identity, restart/reconnect, run order and crypto baseline agree.
- Roadmap run count: PASS; exactly 19 IDs, `BB2-DIRECT-00` through `BB2-DIRECT-18`.
- Acceptance matrix coverage: PASS; exactly 19 Technical IDs, statuses and markers present.
- Git diff scope: PASS; documentation and repository metadata only.
- Legacy safety verification: PASS; service remained active, PID/start time/NRestarts stable and health was HTTP 200 before and after.

## Safety and deferred work

Direct service was not created or started; user `business-bridge-direct` was not created; port `18100` was not bound; firewall was not modified; legacy Bridge was not restarted or changed; BB2-DIRECT-02 was not performed. Legacy endpoint names remain `NEEDS_SOURCE_CONFIRMATION` until source baseline.

Marker: `BB2_DIRECT_01_COMPLETE`.
