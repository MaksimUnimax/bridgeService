# Архитектура Business Bridge 2 Direct Connection

## Legacy и Direct

Legacy: ChatGPT → extension → существующий Bridge transport → `business-bridge-2.service` (`127.0.0.1:18083`) → CLI. Direct: ChatGPT → extension → прямой публичный IPv4 VPS клиента → `business-bridge-2-direct.service` → CLI. Между браузером и VPS нет vendor relay, стороннего relay/control plane разработчика, PowerShell/SSH tunnel, VPN или обязательного домена.

## Компоненты и ownership

Все компоненты принадлежат клиенту: browser, extension, VPS, server, CLI, keys, DB, state, jobs и reports. Direct использует отдельные `/opt/business-bridge-2-direct`, `/etc/business-bridge-2-direct`, `/var/lib/business-bridge-2-direct`, `/var/log/business-bridge-2-direct`, user `business-bridge-direct`, service и port `18100`. Legacy paths, DB, secrets, state и logs не используются.

## Trust boundaries и поток данных

Недоверенная сеть начинается между extension и публичным listener. Public discovery ограничен health/version/safe diagnostics/bootstrap; one-time pairing выполняется через отдельный rate-limited endpoint. После pairing browser и server создают BB2D-P1 session: paired-device/server ECDSA P-256, ephemeral ECDH P-256, HKDF-SHA-256 и directional AES-256-GCM. Fingerprint проверяется отдельно. Protected envelopes аутентифицируют method/path/direction, identity, request ID, nonce, timestamp, expiry и sequence; replay ledger отклоняет повторы. HTTP является carrier и не является доверенной границей.

Целевой control flow: import bundle → fingerprint preview → pairing → protected session → profile/conversation binding → create/status/cancel/report → cursor/reconnect. После BB2-DIRECT-07 реализованы только bootstrap, pairing, protected session и synthetic protected probe. Реальный task/report API является scope BB2-DIRECT-08.

## Failure boundaries

Сетевой обрыв, restart Direct, restart browser, отказ CLI, timeout, replay, identity mismatch и DoS обрабатываются отдельно. BB2-DIRECT-08 добавляет idempotent task/report lifecycle; BB2-DIRECT-09 добавляет полный durable job ledger, startup recovery и ambiguous-operation reconciliation. Краткий обрыв и browser reconnect остаются scope BB2-DIRECT-14/15. Legacy profile сохраняется fallback до полной приёмки.

## Deployment и bind

Публичный IPv4 обязателен. В BB2-DIRECT-04 фактический `eth0` address позволил exact bind `78.17.68.165:18100`; IPv6 не слушается. Host firewall уже имел permissive INPUT policy, поэтому новый framework и правило не создавались. Provider ingress наблюдался разрешённым через внешние probes.

Публичный listener сейчас обслуживает safe discovery, one-time pairing и BB2D-P1 protocol endpoints. Pairing и protocol mutations fail closed, ограничены listener controls и не имеют plaintext fallback. Наличие listener, pairing или protected probe не означает production readiness и не означает, что task/report API уже реализован.
