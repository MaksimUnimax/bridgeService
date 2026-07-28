# BB2-DIRECT-01 documentation evidence

## Scope

Изменены только Markdown-документы и repository metadata. Server runtime, systemd, user, port, firewall, legacy paths, DB, secrets, state и logs не изменялись.

## Files, sizes and SHA-256

| Path | State | Bytes | SHA-256 |
|---|---|---:|---|
| `README.md` | UPDATED | 2695 | `e4f358aee28d9b04d2a5fa28f9944cab485a3900c6f0105fb65a03bfeeac7f73` |
| `docs/product/PRODUCT_DESCRIPTION.md` | CREATED | 5084 | `764cd7ef089520317621145e361cdb9f3fc7ee54fad9ca3082c9375847ea2c8d` |
| `docs/product/FULL_TECHNICAL_SPEC.md` | CREATED | 7167 | `7fbd289acb77687a8feef532c7c4931f5d24fa27c71753e38a88a30a24b1d778` |
| `docs/product/ROADMAP.md` | CREATED | 4310 | `6c7ebbf2c695066b7562f879b8257b28afb535e61b4e3d5b4e2cfcc2e1c5d1fe` |
| `docs/architecture/ARCHITECTURE.md` | CREATED | 2656 | `6882c618a760cc59680c62687041b67ffb41f21b7db0f2e43b5b49347e0a37dd` |
| `docs/architecture/COMPATIBILITY_CONTRACT.md` | CREATED | 1449 | `bdca4b3c5b1ea57762fabce3537bceec8183ea887a36ae51b3e2ea412e54fd0a` |
| `docs/architecture/API_COMPATIBILITY_MATRIX.md` | CREATED | 2147 | `a2aa03089f367dbdfad6e5b14f031fd8eb79e40f3b8777e136eb3a4292cc5c2c` |
| `docs/architecture/SECURITY_MODEL.md` | CREATED | 2491 | `fd1bc99d383b13c7087b8811862f9e4f7f61936c72b10b7892b5fa0922fa816b` |
| `docs/architecture/ACCEPTANCE_MATRIX.md` | CREATED | 2961 | `72f4034577eb08e52a63928029eec70e7b1ad770d00ef852e38201adf7643cf4` |
| `docs/architecture/ROLLBACK_PLAN.md` | CREATED | 1319 | `f7ed09c3d132b77b3b15790caa238ac22e5c07776976432b89f7e63be8431d81` |
| `docs/adr/ADR-001-DIRECT-TRANSPORT.md` | CREATED | 710 | `ad17840b0b148df8beccbec81c67ab22f2748c02cfd72c475175f6c14c5099c0` |
| `docs/adr/ADR-002-APPLICATION-LAYER-CRYPTO.md` | CREATED | 766 | `bd5629c6c936eb0af8d33026fac917c6e7661e67cc4abae0fc6f8adf0b507fe0` |
| `docs/adr/ADR-003-PAIRING-AND-DEVICE-IDENTITY.md` | CREATED | 878 | `78cde153a738412cde6dc92f0316395607b68557f859a6dddb639f6aec80812e` |
| `docs/development/MASTER_CONTEXT_PROMPT.md` | UPDATED | 13055 | `fd5f45174fc69a468cc908e806f4544f24fa505461e94b5f2856839393775fd6` |
| `docs/development/RUN_STATUS.md` | UPDATED | 2717 | `877f538dbdd246edbd4f28bc1806b9568bf1aaaa2f3ed6f4bb2cd24e10214d75` |
| `docs/development/WORKLOG.md` | UPDATED | 4428 | `d36600f0b58f3e9d13b86d157c005d32e93785c6e89395947dba7a51cf6c5f47` |

Evidence file hash is reported after final file assembly; commit SHA is reported after the single commit and push.

## Checks

- Required files present and non-empty: PASS (15 deliverables plus status/worklog support files).
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
