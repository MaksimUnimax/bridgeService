# ADR-001: Direct transport

**Статус:** ACCEPTED FOR IMPLEMENTATION

Extension подключается напрямую к публичному IPv4 VPS клиента через один входящий порт. Relay, control plane разработчика, tunnel, VPN и обязательный домен отсутствуют. Публичный IPv4 обязателен; HTTP может быть carrier, но sensitive payload не передаётся plaintext и HTTP сам по себе безопасным не считается.

## BB2-DIRECT-04 decision

- Selected bind: `78.17.68.165:18100` (`DIRECT_ADDRESS_BIND`).
- `ip -json address show` показал `78.17.68.165/24` на `eth0`; main route и `ip route get 1.1.1.1` использовали source `78.17.68.165`; два независимых account-free IP echo подтвердили адрес.
- NAT/wildcard inference не применяется: public IPv4 является local interface address. Решение не основано на предположении, что public IP всегда является interface address.
- No IPv6 listener exists on 18100; no TLS/domain/tunnel/relay/VPN was added.
- Host firewall already had permissive `INPUT ACCEPT` policy; UFW/firewalld inactive; `FIREWALL_MUTATION=NONE`.

Rollback restores version 0.2.0, config bind `127.0.0.1:18100`, and removes only a run-owned 18100 rule if one ever exists. Legacy `127.0.0.1:18083` remains untouched.
