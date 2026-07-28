# ADR-001: Direct transport

**Статус:** ACCEPTED FOR IMPLEMENTATION

Extension подключается напрямую к публичному IPv4 VPS клиента через один входящий порт. Relay, control plane разработчика, tunnel, VPN и обязательный домен отсутствуют. Публичный IPv4 обязателен; HTTP может быть carrier, но sensitive payload не передаётся plaintext и HTTP сам по себе безопасным не считается. Первый порт — `18100`; bind (конкретный адрес или `0.0.0.0`) подтверждается только в BB2-DIRECT-04.
