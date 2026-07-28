# BB2-DIRECT-04 Public reachability evidence

Status: **ACCEPTED / PASS**  
Final marker: `BB2_DIRECT_04_COMPLETE`

Implementation commits: `cf16289dd60766f67b7a14c56c6f5839e19dc985`, `b4bd13b` (graceful shutdown correction). Acceptance commit follows this evidence. Version is `0.3.0`.

## Bind and network

`78.17.68.165/24` was present on `eth0`; default route was `78.17.68.1` via `eth0`, and `ip route get 1.1.1.1` selected source `78.17.68.165`. Two independent account-free outbound IP echo services returned the same address. The selected mode is `DIRECT_ADDRESS_BIND`, exact `78.17.68.165:18100`; wildcard/NAT mode was not selected. No IPv6 listener exists on 18100.

## Firewall

UFW and firewalld were inactive. nftables and iptables showed `INPUT ACCEPT`, with existing SSH/fail2ban rules unchanged. `FIREWALL_MUTATION=NONE`; no new framework, rule, default-policy change, flush or reset was performed. Provider firewall credentials/API were not read; external ingress was observed allowed by the probes. Backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-04-20260728T065830Z/` (root:root 0700).

## External reachability

The account-free check-host.net probe ran after final deployment and again after restart. TCP: 5/5 independent nodes connected to `78.17.68.165:18100`. HTTP: 5/5 independent nodes returned HTTP 200 for `http://78.17.68.165:18100/v2/health`. The target path and local public-address contract identify the response as Direct 0.3.0. External TCP probe to legacy `78.17.68.165:18083` returned 0/5 successes (connection refused).

Machine-readable redacted results: [external probes](BB2-DIRECT-04_EXTERNAL_PROBE_RESULTS.json). Limit results: [limit tests](BB2-DIRECT-04_LIMIT_TEST_RESULTS.json).

## Runtime and safety

The service is enabled and active/running as `business-bridge-direct`, with listener backlog 32 and exact selected bind. Health, version and public diagnostics returned their exact 0.3.0 contracts and required no-store/nosniff/close/content-length headers. Negative live tests returned 404, 405, 414, 431, 413 and 400 as specified; concurrency overflow returned 503; per-source overflow returned 429 with `Retry-After`; slow partial input closed after the 5-second timeout. Repository, staging and installed tests passed: 16 collected, 16 passed, 0 failed, 0 skipped. `systemd-analyze verify` passed.

SQLite remains `user_version=1` with only `runtime_metadata`; its service version is 0.3.0. Source and installed package hashes match. Secrets remain empty. No prompts, reports, tasks, identity, pairing, crypto, credentials or sensitive payloads were implemented or exposed.

One successful controlled Direct restart changed PID `1664395` to `1664423`, kept `NRestarts=0`, restored the exact public listener, and was followed by successful external probes. The legacy PID `1619365`, start time `Mon 2026-07-27 13:16:29 MSK`, NRestarts 0, localhost listener and health 200 remained unchanged; the legacy unit was not restarted or modified.

## Rollback and limitations

Rollback uses the saved Direct-only backup, restores 0.2.0 and `127.0.0.1:18100`, and removes only a run-owned 18100 firewall rule (none was added). Legacy paths and data are untouched. Public endpoints are diagnostics/bootstrap only; there is no production readiness claim, TLS, identity, pairing, application-layer encryption, task/report transport, extension profile or relay/tunnel.
