# API compatibility matrix

The following facts are confirmed from the read-only legacy source inventory.
Legacy health remains source-confirmed. Direct now has a deliberately
separate public IPv4 diagnostic surface; task/report compatibility remains
deferred.

| Function | Legacy source-confirmed endpoint/mechanism | Direct baseline status | Source | Status |
|---|---|---|---|---|
| Legacy health | `GET /v2/health` in `Bridge2Application.handle` | Source-confirmed; legacy remains 200 | `app/api.py:61-69` | CONFIRMED |
| Direct health | — | `GET /v2/health` public, DB-gated | `docs/development/evidence/BB2-DIRECT-04_PUBLIC_REACHABILITY_EVIDENCE.md` | IMPLEMENTED |
| Direct version | — | `GET /v2/version` public, Direct-only | `docs/development/evidence/BB2-DIRECT-04_PUBLIC_REACHABILITY_EVIDENCE.md` | IMPLEMENTED |
| Direct diagnostics | — | `GET /v2/diagnostics/public` public, safe diagnostics | `docs/development/evidence/BB2-DIRECT-04_PUBLIC_REACHABILITY_EVIDENCE.md` | IMPLEMENTED |
| Identity | `GET /v2/identity`, bearer authorization | Runtime deferred | `app/api.py:71-92`, `app/security.py:125-140` | CONFIRMED |
| Executor listing | `GET /v2/executors`, database health rows plus health manager definitions | Runtime deferred | `app/api.py:94-125` | CONFIRMED |
| Executor refresh | `POST /v2/executors/refresh`, refresh manager request | Runtime deferred | `app/api.py:127-137` | CONFIRMED |
| Chain creation | `POST /v2/chains`, idempotency key and generated chain ID | Runtime deferred | `app/api.py:139-167`, `app/database.py:372-410` | CONFIRMED |
| Chain state | `GET /v2/chains/<chain_id>` and `POST` pause/resume/terminate | Runtime deferred | `app/api.py:169-228`, `app/database.py:411-466` | CONFIRMED |
| Conversation binding | `POST /v2/chains/<chain_id>/bind-conversation` | Runtime deferred | `app/api.py:189-208`, `app/database.py:443-466` | CONFIRMED |
| Job creation | `POST /v2/chains/<chain_id>/jobs`, idempotency key and sequence | Runtime deferred | `app/api.py:229-286`, `app/database.py:470-563` | CONFIRMED |
| Job status | `GET /v2/jobs/<job_id>` with optional `after_revision` | Runtime deferred | `app/api.py:288-313`, `app/database.py:564-625` | CONFIRMED |
| Delivery claim | `POST /v2/jobs/<job_id>/delivery/claim` | Runtime deferred | `app/api.py:314-341`, `app/database.py:774-805` | CONFIRMED |
| Delivery commit | `POST /v2/jobs/<job_id>/delivery/commit` | Runtime deferred | `app/api.py:342-360`, `app/database.py:806-832` | CONFIRMED |
| Delivery confirmation | `POST /v2/jobs/<job_id>/delivery/confirm` | Runtime deferred | `app/api.py:361-377`, `app/database.py:833-889` | CONFIRMED |
| Job execution | Supervisor dispatches queued jobs through configured executors | Runtime deferred | `app/executor_supervisor.py:55-322` | CONFIRMED |
| Executor probing | Registry definitions and refresh manager run configured probes | Runtime deferred | `app/executor_registry.py:22-334` | CONFIRMED |
| Persistence | SQLite database abstraction with chains, jobs, deliveries and events | Excluded from this baseline | `app/database.py:70-889` | CONFIRMED |

Direct task, report, identity, crypto, executor and extension transport compatibility remains deferred; pairing is implemented by BB2-DIRECT-06 only.

| Direct bootstrap | — | `GET /v2/bootstrap`, public key and fingerprint discovery only | BB2-DIRECT-05 evidence | IMPLEMENTED |

The legacy identity endpoint remains separate and no bearer-compatibility claim is made. `POST /v2/pairing/complete` is Direct-only, one-time, rate-limited and does not accept a private key.
