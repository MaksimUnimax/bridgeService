# BB2-DIRECT-02-FIX1 source baseline evidence

TECHNICAL_ID: `BB2-DIRECT-02-FIX1`

## Result

STATUS: PASS

The original blocker was `invalid command 'bdist_wheel'`: the isolated build
environment did not contain `wheel`, while the selected packaging path invoked
the legacy command. The correction was to declare the PEP 517 backend and
install `setuptools` and `wheel` inside the Direct staging venv, then use the
supported `python -m pip install` and `python -m pip wheel` paths. No global
package installation or system package installation was used.

Expected base: `e4cdb42828f4a131e420e6ece993be35fde8e0cc`
Source commit before this evidence commit: `032ccadfe14495f97325b98b148991e7e80d37a7`

## Preflight and legacy safety

| Check | Before | After | Result |
|---|---|---|---|
| Repository | `/root/bridgeService-development` | same | PASS |
| Branch | `development` | `development` | PASS |
| Local HEAD | `e4cdb42828f4a131e420e6ece993be35fde8e0cc` | linear descendants only | PASS |
| Remote development before | `e4cdb42828f4a131e420e6ece993be35fde8e0cc` | gate performed before push | PASS |
| Remote main before | `c426263e6dd00135a0023a0fa08a500273e73e23` | unchanged at gate | PASS |
| Worktree | clean before changes | clean before gate | PASS |
| Legacy MainPID | `1619365` | `1619365` | PASS |
| Legacy ActiveEnterTimestamp | `Mon 2026-07-27 13:16:29 MSK` | unchanged | PASS |
| Legacy NRestarts | `0` | `0` | PASS |
| Legacy state | `active/running` | `active/running` | PASS |
| Legacy health | `GET /v2/health` HTTP 200 | HTTP 200 | PASS |

Legacy service metadata was read without environment secrets. Legacy source
was read-only. Forbidden secrets, database rows, state, logs, token values,
process environment and private keys were not read. Legacy service was not
modified, stopped, reloaded, restarted, or copied.

## Legacy source inventory

- Entrypoint: `/usr/bin/env python3 -m app.main`, confirmed by systemd `ExecStart`.
- Python: `3.10.12`.
- Dependency files: `/opt/business-bridge-2/pyproject.toml`, `requirements.txt`, `setup.py`, and `setup.cfg` were absent; legacy README was present.
- API router: `/opt/business-bridge-2/app/api.py`, `Bridge2Application.handle`.
- Job mechanisms: `app/api.py`, `app/database.py`, `app/executor_supervisor.py`.
- Storage: `app/database.py`, class `Bridge2Database`, SQLite schema and delivery rows.
- Configuration: `app/config.py`, class `Bridge2Config`.
- Logging: `app/main.py` and API handler logging paths; no logging module was copied.
- Security: `app/security.py`, bearer authorization and token/identity file handling.
- Executor registry/probing: `app/executor_registry.py` and `ExecutorHealthManager`.
- Scheduler: `app/scheduler.py`, `ServiceScheduler`.
- Included Direct module: only a newly authored side-effect-free `defaults.py` representation of the required Direct defaults.
- Excluded modules: API, database, security, executor registry, executor supervisor, scheduler, and main; they are runtime/data-coupled and deferred to their scoped runs.
- Limitation: this baseline confirms source symbols and routes, not a Direct runtime implementation.

Legacy source SHA-256 mappings:

| Legacy path | Legacy SHA-256 | Direct path | Direct SHA-256 | Classification |
|---|---|---|---|---|
| `app/__init__.py` | `4b4cc3ceefa01d7c1f0cef4bd6cb910f8fd6846b9f32a80ee281ab6c65739567` | none | none | excluded package identity |
| `app/api.py` | `160b506364f48477ea07ca3fa2c84b57bcf94deb9b24c04d7140e8a8aa3c3920` | none | none | excluded HTTP/runtime |
| `app/config.py` | `bdb4ac4f7e0f21a43eee8430287bb23cdbb943da6245ef59ced43a17c7189079` | `server/src/business_bridge_direct/defaults.py` | `2e06b0a94c3843368442a67d39a321cd926effee3da918512d66e116d04602d5` | narrowed defaults adaptation |
| `app/database.py` | `5b84582197b87d7a8e99d416de8fea8358f9b554eee0f925231cb08c88af7ac7` | none | none | excluded SQLite |
| `app/executor_registry.py` | `bc9753d5a95e1811ac12ce8a46ac404c068f6f4620ab9fb86632bd67247057fc` | none | none | excluded subprocess/probes |
| `app/executor_supervisor.py` | `96f0f67a028d8c569ff9174f51b14595c4547f571f77109a582dc728c12b18e1` | none | none | excluded job runtime |
| `app/main.py` | `9171a0ec6cf31dddc6bfb19d8af9b38be00ae203875b1f0eb791de0d65e909e9` | none | none | excluded entrypoint/service |
| `app/scheduler.py` | `def4ba2d2264fb5fc962344995c21fddbe15f4b576f51f65d602955edaad7a94` | none | none | excluded scheduler |
| `app/security.py` | `586c0890f18a1736b08a71f91d778a2f3e663439dff4f2f66a035eb559af21db` | none | none | excluded secrets/auth |

The compatibility matrix contains only these source-confirmed routes and
mechanisms; no endpoint or behavior was invented.

## Package and Direct defaults

- Distribution: `business-bridge-2-direct`
- Import: `business_bridge_direct`
- Version: `0.1.0`
- Source: `server/src/business_bridge_direct/`
- Install tree: `/opt/business-bridge-2-direct`
- Venv: `/opt/business-bridge-2-direct/.venv`
- Defaults: `INSTALL_DIR=/opt/business-bridge-2-direct`, `CONFIG_DIR=/etc/business-bridge-2-direct`, `SECRETS_DIR=/etc/business-bridge-2-direct/secrets`, `STATE_DIR=/var/lib/business-bridge-2-direct`, `DATABASE_PATH=/var/lib/business-bridge-2-direct/bridge.sqlite3`, `LOG_DIR=/var/log/business-bridge-2-direct`, `SERVICE_NAME=business-bridge-2-direct.service`, `SERVICE_USER=business-bridge-direct`, `LISTEN_HOST=127.0.0.1`, `LISTEN_PORT=18100`.
- Import result: PASS.
- All-module import result: PASS (`business_bridge_direct.defaults`).
- Distribution metadata result: PASS (`business-bridge-2-direct`, `0.1.0`).

## Build toolchain

- Python: `3.10.12`.
- PIP before correction: `22.0.2`, inside staging venv.
- PIP after correction: `26.1.2`, inside staging venv.
- Setuptools: `83.0.0`; location inside venv: `/opt/business-bridge-2-direct/.venv/lib/python3.10/site-packages`.
- Wheel: `0.47.0`; location inside venv: `/opt/business-bridge-2-direct/.venv/lib/python3.10/site-packages`.
- Wheel import: PASS.
- `sys.prefix` differed from `sys.base_prefix`; `include-system-site-packages = false`.
- Build backend: `setuptools.build_meta`.
- Build requirements: `setuptools>=65`, `wheel>=0.40`.
- Installation command: `python -m pip install --disable-pip-version-check --no-input --no-deps --no-build-isolation .`.
- Installation result: PASS.
- Wheel command: `python -m pip wheel --disable-pip-version-check --no-input --no-deps --no-build-isolation --wheel-dir <safe-temporary-wheel-dir> .`.
- Wheel build result: PASS.
- Test wheel SHA-256: `1821613b573ce4e899f74ed315f59aa596d11608b98c238a69060b3bfd577908`.
- Direct `setup.py bdist_wheel`: NO.
- Global install: NO.
- APT install: NO.

## Files and hashes

| Path | Size | SHA-256 |
|---|---:|---|
| `server/.gitignore` | 76 | `6a0181cce1d14767324ecfb78802afe2837ff93f73bf455f783887915e4f7771` |
| `server/README_DEVELOPMENT.md` | 2963 | `8498b210dbb16087827f6bb67a90e859db909e1f9c8e0c621035f3e176200465` |
| `server/pyproject.toml` | 436 | `1dbe2a410003c6f3192824467aefe42362c107eb5ad14b657a66149478effd30` |
| `server/src/business_bridge_direct/__init__.py` | 170 | `9f2d502b62ae43c7d85525d3dc6c1f0eb56d7bbd154cf4f84f2dcdca92689005` |
| `server/src/business_bridge_direct/defaults.py` | 884 | `2e06b0a94c3843368442a67d39a321cd926effee3da918512d66e116d04602d5` |
| `server/src/business_bridge_direct/py.typed` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `tests/server/test_baseline.py` | 5061 | recorded in repository commit and source tree |

`server/FILE_MANIFEST.sha256` is sorted, uses relative POSIX paths, has 6
entries, excludes itself, cache, venv and wheel artifacts, and verifies PASS.
Repository and installed source hashes match for all manifest entries.

## Tests and commands

| Context | Command | Result | Collected | Passed | Failed | Skipped |
|---|---|---|---:|---:|---:|---:|
| Repository | `PYTHONPATH=server/src PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/server -p 'test_*.py' -v` | PASS | 7 | 7 | 0 | 0 |
| Staging | `VIRTUAL_ENV=<staging> <staging>/.venv/bin/python -m unittest discover -s <staging>/tests/server -p 'test_*.py' -v` | PASS | 7 | 7 | 0 | 0 |
| Final tree | `VIRTUAL_ENV=/opt/business-bridge-2-direct/.venv /opt/business-bridge-2-direct/.venv/bin/python -m unittest discover -s /opt/business-bridge-2-direct/tests/server -p 'test_*.py' -v` | PASS | 7 | 7 | 0 | 0 |
| Manifest | `sha256` verification over `server/FILE_MANIFEST.sha256` | PASS | 6 | 6 | 0 | 0 |

Test duration was under one second in each baseline context. No packaging,
wheel-import, staged-import, or manifest check was skipped.

## Acceptance criteria

1. PASS — legacy healthy before.
2. PASS — legacy healthy after.
3. PASS — legacy PID unchanged.
4. PASS — legacy start time unchanged.
5. PASS — legacy NRestarts unchanged.
6. PASS — legacy service not modified.
7. PASS — legacy service not restarted.
8. PASS — legacy source read-only.
9. PASS — legacy secrets not read.
10. PASS — legacy DB/state/logs not read or copied.
11. PASS — correct repository and development branch.
12. PASS — expected local base matched.
13. PASS — expected remote development base matched.
14. PASS — remote main recorded and unchanged.
15. PASS — worktree clean before changes.
16. PASS — Direct paths had no conflict.
17. PASS — safe legacy source inventory completed.
18. PASS — legacy entrypoint source-confirmed.
19. PASS — relevant API/mechanism inventory completed.
20. PASS — API matrix source-confirmed only.
21. PASS — no endpoint or behavior invented.
22. PASS — canonical `server/` baseline created.
23. PASS — distribution identity correct.
24. PASS — import identity correct.
25. PASS — package does not import legacy `app`.
26. PASS — Direct defaults exact.
27. PASS — no literal legacy path/token/DB dependency.
28. PASS — only necessary reusable source adapted.
29. PASS — included/excluded rationale documented.
30. PASS — no secrets or production data copied.
31. PASS — no legacy venv copied.
32. PASS — separate Direct venv created.
33. PASS — venv excludes system site packages.
34. PASS — build backend explicit.
35. PASS — setuptools declared.
36. PASS — wheel declared.
37. PASS — setuptools installed in Direct venv.
38. PASS — wheel installed in Direct venv.
39. PASS — wheel import passes.
40. PASS — no global Python installation.
41. PASS — no apt/system installation.
42. PASS — direct `setup.py bdist_wheel` not invoked.
43. PASS — corrected package installation.
44. PASS — wheel build proof.
45. PASS — repository package imports.
46. PASS — installed Direct package imports.
47. PASS — all new modules import.
48. PASS — import has no filesystem/network/process side effects.
49. PASS — repository tests pass.
50. PASS — staging tests pass.
51. PASS — final Direct tests pass.
52. PASS — no required packaging test skipped.
53. PASS — exact test counts reported.
54. PASS — manifest exists.
55. PASS — manifest deterministic and valid.
56. PASS — repository/install hashes match.
57. PASS — developer README complete.
58. PASS — target created by atomic rename.
59. PASS — Direct service absent.
60. PASS — Direct service not started.
61. PASS — Direct user absent.
62. PASS — Direct process absent.
63. PASS — TCP/18100 free.
64. PASS — no listener created.
65. PASS — Direct DB absent.
66. PASS — config/secrets/state/log directories absent.
67. PASS — firewall not modified.
68. PASS — repository changes within allowed paths.
69. PASS — secret, placeholder, merge-marker scans pass.
70. PASS — RUN_STATUS, WORKLOG and evidence complete.
71. PASS — linear commits and development-only push policy.
72. PASS — remote development final and main unchanged.
73. PASS — BB2-DIRECT-03 not executed; final marker correct.

## Final Direct and security state

- `/opt/business-bridge-2-direct`: PRESENT, created by this FIX1 atomic rename.
- `.venv`, setuptools, wheel, installed package: PRESENT and verified.
- Service, service user, process, listener, database: ABSENT.
- `/etc/business-bridge-2-direct`, secrets, state and log directories: ABSENT.
- TCP/18100: free.
- Secret scan: PASS; no private key blocks, credentials, token values, `.env`, database, logs, reports, cookies or production data in changed paths.
- Public history secret scan: PASS for published diff.
- Firewall: not modified.
- Rollback remains limited to the exact FIX1 target/staging path after symlink, mount, ownership and marker safety checks; legacy resources and published Git history are not rollback targets.

## Documentation and deferred scope

`RUN_STATUS.md` records BB2-DIRECT-00, 01 and 02 as `ACCEPTED / PASS`,
BB2-DIRECT-03 through 18 as `NOT STARTED`, marker `BB2_DIRECT_02_COMPLETE`,
and next run `BB2-DIRECT-03`. `WORKLOG.md` records the initial blocked run,
the `bdist_wheel` blocker, this FIX1 correction, tests, package identity,
Direct path, no runtime activation, and next run. Service activation,
listener, user, database, secrets, pairing, crypto, task runtime and
extension integration remain deferred to their explicitly numbered runs.

Evidence commit: recorded after this file is committed.
Final marker: `BB2_DIRECT_02_COMPLETE`.
