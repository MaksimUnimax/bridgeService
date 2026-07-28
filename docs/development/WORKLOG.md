# Business Bridge 2 Direct — журнал работ

## 2026-07-28 — Инициализация репозитория

### Выполнено

- Подтверждён публичный репозиторий `MaksimUnimax/bridgeService`.
- Создана продовая ветка `main` с базовым `README.md`.
- Создана рабочая ветка `development`.
- Зафиксирована политика репозитория и публичной истории.
- Создан трекер 19 основных ранов.
- Зафиксировано, что рабочая история проекта должна отражаться в GitHub.

### Решение по истории

- Текущая разработка ведётся в `development`.
- В `main` попадают только принятые продовые материалы.
- Перед релизом допускается squash merge и удаление временной ветки.
- Секретные данные не публикуются даже временно, поскольку полное удаление из публичной Git-истории не гарантируется.

---

## BB2-DIRECT-00 — Read-only инвентаризация

**Статус:** ACCEPTED / PASS

### Зафиксировано

- Действующая служба: `business-bridge-2.service`.
- Рабочий каталог: `/opt/business-bridge-2`.
- Процесс: `python3 -m app.main`.
- Runtime: Python `3.10.12`.
- Listen: `127.0.0.1:18083`.
- Health: `GET /v2/health → HTTP 200` до и после проверки.
- Публичный IPv4: `78.17.68.165`.
- Порты `18100–18199` были свободны на момент проверки.
- Выбран первичный порт новой версии `18100`.
- Определены полностью изолированные каталоги и новая systemd-служба.
- Действующий Bridge не изменён и не перезапущен.

### Изолированные ресурсы новой версии

- `/opt/business-bridge-2-direct`;
- `/etc/business-bridge-2-direct`;
- `/var/lib/business-bridge-2-direct`;
- `/var/log/business-bridge-2-direct`;
- `business-bridge-2-direct.service`;
- пользователь `business-bridge-direct`.

### Marker

```text
BB2_DIRECT_00_READ_ONLY_COMPLETE
```

### Следующий ран

`BB2-DIRECT-01` — архитектурный, продуктовый и совместимый контракт.

---

## BB2-DIRECT-01 — продуктовый, архитектурный и совместимый контракт

**Статус:** ACCEPTED / PASS

### Созданные и обновлённые материалы

Созданы product, architecture, security, compatibility, acceptance, rollback и три ADR-документа; обновлены README, master context, run status и этот worklog; добавлено documentation evidence.

### Принятые решения

- Direct — прямое соединение extension с публичным IPv4 VPS клиента без relay/control plane, tunnel или обязательного домена.
- Bundle выдаёт CLI, содержит одноразовые pairing-данные, не содержит постоянный private key.
- Sensitive payload защищается application-layer encryption; legacy остаётся fallback.
- Direct получает отдельные paths/DB/secrets/service/user/port; bind подтверждается в BB2-DIRECT-04.
- Pairing имеет TTL 5–10 минут, single-use, limits, device identity и revoke.

### Проверки и ограничения

Выполнены проверки наличия/непустоты файлов, Markdown-ссылок, placeholder/secret scans, terminology/cross-document consistency, 19-run count, acceptance coverage, SHA-256 и git diff. Runtime, systemd unit, user, порт 18100, firewall, legacy Bridge и BB2-DIRECT-02 не затрагивались. Неподтверждённые legacy endpoint’ы оставлены `NEEDS_SOURCE_CONFIRMATION` до BB2-DIRECT-02/08.

### Marker и следующий ран

`BB2_DIRECT_01_COMPLETE`.

Следующий ран: `BB2-DIRECT-02` — изолированный source baseline.

## BB2-DIRECT-01-FIX1 — controlled acceptance continuation

Документационный follow-up исправил явность product/network/security/API/rollback contract в разрешённых файлах. Runtime Business Bridge 2 Direct не создавался и не запускался; действующий legacy Bridge не изменялся и не перезапускался. Commit SHA финальной публикации будет зафиксирован в evidence после обычного follow-up commit; следующий ран остаётся `BB2-DIRECT-02`.

Marker: `BB2_DIRECT_01_COMPLETE`.

## 2026-07-28 — BB2-DIRECT-02-FIX1 — isolated source baseline

### Контекст и исправление

- Первоначальная попытка BB2-DIRECT-02 была `BLOCKED` с ошибкой `invalid command 'bdist_wheel'`.
- Причина: isolated staging environment не содержал пакет `wheel`, а packaging path вызывал legacy `bdist_wheel`.
- FIX1 ограничен этим blocker: объявлен PEP 517 backend `setuptools.build_meta`, build requirements `setuptools>=65` и `wheel>=0.40`, а toolchain установлен только в Direct staging venv.
- `wheel` импортирован из staging venv; установка и wheel build выполнены через `python -m pip` с `--no-build-isolation` без прямого вызова setup.py.

### Baseline и безопасность

- Создана canonical source tree `server/src/business_bridge_direct/` с distribution `business-bridge-2-direct`.
- Включён только side-effect-free configuration defaults; legacy API, SQLite, secrets, executor subprocesses, scheduler и service activation исключены и документированы.
- Staging установлен атомарно в `/opt/business-bridge-2-direct`; service, user, process, listener, DB и runtime directories не создавались.
- Legacy Bridge оставался healthy, его PID/start time/NRestarts не изменились; legacy source читался только read-only.

### Проверки и публикация

- Repository, staging и final-tree baseline tests: 7 collected, 7 passed, 0 failed, 0 skipped.
- Manifest SHA-256 verification: PASS; source/install hash comparison: PASS.
- Evidence фиксирует resolved toolchain, source inventory, hashes, acceptance criteria и final safety state.
- Commit и remote publication SHA зафиксированы в evidence.

Marker: `BB2_DIRECT_02_COMPLETE`.
Следующий ран: `BB2-DIRECT-03`.
