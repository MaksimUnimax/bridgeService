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
