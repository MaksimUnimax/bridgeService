# Business Bridge 2 Direct public service

This directory contains the isolated `0.4.0` Direct service accepted by
`BB2-DIRECT-05`. It uses only Python 3.10 standard-library runtime modules,
binds to `78.17.68.165:18100`, and has no legacy Bridge dependency.

## Identity and layout

- Distribution: `business-bridge-2-direct`
- Import package: `business_bridge_direct`
- Source: `src/business_bridge_direct/`
- Tests: `../tests/server/`
- Manifest: `FILE_MANIFEST.sha256`

The planned Direct paths are `/opt/business-bridge-2-direct`,
`/etc/business-bridge-2-direct`, `/etc/business-bridge-2-direct/secrets`,
`/var/lib/business-bridge-2-direct`, and `/var/log/business-bridge-2-direct`.
The planned service is `business-bridge-2-direct.service`, user is
`business-bridge-direct`, and the reserved listener is `78.17.68.165:18100`.

## Isolated build and tests

The supported interpreter is Python 3.10.12. Create an
isolated environment with `python3 -m venv .venv`; system site packages are
not permitted. Inside that environment, bootstrap the build toolchain with:

```text
python -m ensurepip --upgrade
python -m pip install --disable-pip-version-check --no-input --upgrade pip setuptools wheel
```

`setuptools` is the declared PEP 517 build backend implementation. `wheel` is
the build requirement that supplies wheel packaging support; neither is a
business runtime dependency. The corrected installation path is:

```text
python -m pip install --disable-pip-version-check --no-input --no-deps --no-build-isolation .
python -m pip wheel --disable-pip-version-check --no-input --no-deps --no-build-isolation --wheel-dir /safe/temporary/wheel-dir .
```

The generated wheel is verification-only and is excluded from the manifest.
Run tests with `python -m pytest -q ../tests/server` and verify the manifest
with the manifest-check command recorded in the evidence.

## Source boundary

The legacy source inventory identified `app/api.py` as the router,
`app/database.py` as SQLite persistence, `app/config.py` as configuration,
`app/security.py` as token and identity handling,
`app/executor_registry.py` and `app/executor_supervisor.py` as executor/job
orchestration, and `app/scheduler.py` as scheduling. None are copied or
imported here: their runtime coupling and data access require later scoped
runs. No legacy data, virtual environment, configuration values, secrets,
database, logs, reports, or state are reused.

The runtime entrypoint is `python -m business_bridge_direct.main --config
.../service.json`. Identity is explicitly provisioned with the identity CLI;
startup validates the existing PKCS#8 key and metadata, performs public-only
P-256 inspection and synthetic sign/verify, and only then binds. The service
exposes health, version, diagnostics, and deterministic public bootstrap.
Pairing, device identity, crypto, tasks, reports, and extension transport
remain out of scope. Rollback removes only Direct resources after ownership
and marker checks; legacy resources remain untouched.

## Security policy

Source and evidence contain no credentials, token values, private keys,
production data, or secret configuration. Runtime secrets must be introduced
only by their future scoped activation workflow.
