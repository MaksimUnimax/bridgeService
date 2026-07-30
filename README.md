# Business Bridge 2 Direct Connection

Business Bridge 2 связывает ChatGPT в браузере пользователя с Codex или другой CLI на собственном VPS пользователя.

Цель Direct Connection — сохранить существующую механику заданий и отчётов, но убрать необходимость вручную запускать PowerShell/SSH-туннель.

## Целевая схема

```text
ChatGPT
→ Chrome Extension Business Bridge 2
→ прямое защищённое подключение к публичному IP VPS пользователя
→ Business Bridge 2 Direct
→ Codex / CLI пользователя
→ отчёт в тот же диалог ChatGPT
```

## Условия

- Linux VPS с публичным IPv4;
- доступный входящий TCP-порт;
- Chrome/Chromium;
- Codex или другая поддерживаемая CLI;
- без vendor relay, стороннего relay, Cloudflare Tunnel, Tailscale, Ngrok, VPN, PowerShell/SSH tunnel и обязательного домена.

## Состояние проекта

`BB2-DIRECT-08` принят. Direct `0.7.0/schema 4` имеет защищённый `BB2D-P1` task/report API: создание задания, status, cancel, report, immutable operation ID, canonical idempotency, payload conflict и повторное получение отчёта. Source, installed-wheel, rollback и production acceptance прошли; независимый Chromium/Web Crypto probe прошёл 6/6 запусков. Legacy Bridge не изменён. Следующий ран — `BB2-DIRECT-09`, durable jobs and recovery.

## Документация

- [описание продукта](docs/product/PRODUCT_DESCRIPTION.md)
- [полное техническое задание](docs/product/FULL_TECHNICAL_SPEC.md)
- [roadmap](docs/product/ROADMAP.md)
- [архитектура](docs/architecture/ARCHITECTURE.md)
- [статус ранов](docs/development/RUN_STATUS.md)

Прямое соединение не является tunnel и не использует relay/control plane разработчика. Сервер принадлежит клиенту; обязателен публичный IPv4, домен не обязателен. Legacy сохраняется как fallback.

## Безопасность

Никогда не публикуйте в Issues, Pull Requests, логах или файлах репозитория токены, пароли, cookies, приватные ключи, pairing codes и содержимое пользовательских заданий. Direct не использует рабочую DB или secrets legacy Bridge.
