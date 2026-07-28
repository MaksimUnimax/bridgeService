# Rollback plan

Direct всегда устанавливается параллельно: отдельные paths, DB, secrets, state, logs, user, service и порт. Legacy Bridge остаётся рабочим fallback до BB2-DIRECT-18 и не удаляется. При проблеме отключается только Direct service и extension возвращается к legacy profile; Direct listener не должен влиять на `127.0.0.1:18083`.

BB2-DIRECT-03 backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-03-20260728T063226Z`.
Rollback checks the marker, ownership, non-symlink/non-mount state and exact
Direct hashes; it stops/disables only `business-bridge-2-direct.service`,
removes only its unit/config/state/log/user resources, restores the saved
Direct install tree, reloads systemd, verifies baseline and port 18100, and
rechecks legacy health. Legacy files, unit, database, state, logs and secrets
are never read or restored.

Installer обязан иметь backup Direct state/config, versioned upgrade и обратимый rollback package. Uninstall удаляет только Direct-артефакты по подтверждённой политике и не читает/не меняет legacy. Backup восстанавливается только в Direct paths.

BB2-DIRECT-04 backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-04-20260728T065830Z`; source version `0.2.0`, source bind `127.0.0.1:18100`. Rollback firewall is a point inverse for only a run-owned TCP/18100 rule (this run used `NONE`); provider firewall was not mutated. Restore the saved Direct venv/config/unit, daemon-reload only for unit restore, start Direct, then verify 0.2.0 localhost health and schema. Identity backup/restore does not use old secrets.

Критерии остановки: неверная identity/fingerprint, plaintext sensitive payload, cross-conversation leak, повтор job после retry, неработающий revoke, изменение legacy, secrets в logs/repository, неожиданный listener или невозможность восстановить Direct. После `FAILED/BLOCKED` допускается максимум один FIX1; затем раны останавливаются.

BB2-DIRECT-05 rollback uses the pre-run Direct backup and retained root-only identity backup. Stop only Direct, archive active identity artifacts root-only, restore 0.3.0 install/config/unit/DB, and verify identity `not_configured`, bootstrap 404, bind `78.17.68.165:18100` and schema version 1. Legacy remains untouched and firewall mutation is none; production identity is never silently overwritten.

BB2-DIRECT-06-FIX1 pre-mutation backup: `/var/backups/business-bridge-2-direct/BB2-DIRECT-06-FIX1-pre-20260728T114412Z/`. It contains the dirty repository snapshot, Direct install/config/unit, SQLite backup via SQLite backup API, identity metadata and private-key pair with root-only permissions. Rollback is Direct-only: restore the saved 0.4.0 tree/config/unit/database/identity, daemon-reload and start only `business-bridge-2-direct.service`; never touch `business-bridge-2.service` or legacy state.
## BB2-DIRECT-07 rollback

The recorded Direct-only backup restores application 0.5.0/schema 2, identity, signing key and pairing state. Stop/start scope is limited to `business-bridge-2-direct.service`; legacy paths, database, service and listener are never part of rollback.
