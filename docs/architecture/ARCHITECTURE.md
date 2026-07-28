# Архитектура Business Bridge 2 Direct Connection

## Legacy и Direct

Legacy: ChatGPT → extension → существующий Bridge transport → `business-bridge-2.service` (`127.0.0.1:18083`) → CLI. Direct: ChatGPT → extension → прямой публичный IPv4 VPS клиента → `business-bridge-2-direct.service` → CLI. Между браузером и VPS нет relay/control plane разработчика, tunnel, VPN или обязательного домена.

## Компоненты и ownership

Все компоненты принадлежат клиенту: browser, extension, VPS, server, CLI, keys, DB, state, jobs и reports. Direct использует отдельные `/opt/business-bridge-2-direct`, `/etc/business-bridge-2-direct`, `/var/lib/business-bridge-2-direct`, `/var/log/business-bridge-2-direct`, user `business-bridge-direct`, service и initial port `18100`. Legacy paths, DB, secrets, state и logs не используются.

## Trust boundaries и поток данных

Недоверенная сеть начинается между extension и публичным listener. Bundle bootstrap приводит к проверке server fingerprint и одноразовому pairing; после этого browser/server обмениваются versioned encrypted application envelopes. Payload шифруется и аутентифицируется на прикладном уровне; HTTP может быть carrier и не является защитой сам по себе. Control flow: import → fingerprint preview → pairing → profile/conversation binding → create/status/cancel/report → cursor/reconnect.

## Failure boundaries

Сетевой обрыв, restart Direct, restart browser, отказ CLI, timeout, replay, identity mismatch и DoS обрабатываются отдельно. Durable job ledger и report storage предотвращают повтор принятой операции. Краткий обрыв восстанавливается автоматически; после restart достаточно «Подключить». Legacy profile остаётся fallback до полной приёмки.

## Deployment и bind

Публичный IPv4 обязателен, первый стенд — `78.17.68.165`. Разрешены bind конкретного интерфейсного адреса или `0.0.0.0:18100`; окончательный выбор и firewall проверяются только в BB2-DIRECT-04. В этом ране listener и служба не создаются.
