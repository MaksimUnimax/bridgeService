# Business Bridge 2 Direct profiles — BB2-DIRECT-11

Run 11 adds Direct server profile management without changing the existing Legacy Bridge transport.

## User flow

1. Paste one server-generated `BB2D1` connection bundle into the Direct section of the popup.
2. Click **Проверить bundle** and inspect the IP, port, instance ID, expiry and SHA-256 server fingerprint.
3. Explicitly tick the identity confirmation checkbox.
4. Click **Подтвердить и подключить**. The popup requests permission only for the bundle IP (`http://<IPv4>/*`). Chrome match patterns cannot restrict a grant to one TCP port, while the profile itself remains pinned to the exact bundle port.
5. The service worker generates a new P-256 device key, completes one-time pairing, then immediately performs a signed `BB2D-L1 status` request. The profile becomes connected only after the response verifies against the server public key/fingerprint pinned by the bundle.

The unsigned `/v2/bootstrap` response is used only as an early identity-change indicator. It never establishes trust by itself; a valid pinned server signature is still required.

## Local lifecycle

- **Статус** performs a signed remote `BB2D-L1 status` check.
- **Подключить** performs the same signed verification and marks the local profile connected.
- **Отключить** changes only local connection state; it does not revoke the device.
- **Переименовать** changes only the local profile name.
- **Отозвать устройство** performs signed idempotent remote revoke and retains enough local key material to verify the signed result.
- **Удалить локально** is intentionally distinct from revoke. Deleting an ACTIVE profile requires explicit confirmation because local deletion does not revoke its server identity.

Direct task execution is deliberately not part of run 11. `BB2-DIRECT-12-EXT` owns the protected task transport.

## Key and profile isolation

Direct metadata is stored separately from Legacy profiles and tokens. Device private keys are kept in a separate `chrome.storage.local` vault, and storage is restricted to trusted extension contexts with `chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"})`.

The content script never imports Direct key code. Direct management messages are rejected when they originate from a tab/content-script sender. Popup/public profile objects expose only `has_private_key`, never PKCS8 or a key reference.

Settings backups include Direct profile metadata but explicitly exclude Direct private keys. Importing Direct metadata into a browser that does not already possess the matching key restores the profile as `NEEDS_REPAIR` and requires re-pairing. Existing Legacy profiles, credentials and conversation bindings remain independent.

## Identity change

Every Direct profile pins:

- server instance ID;
- exact P-256 server public key;
- SHA-256 server fingerprint;
- rotation generation;
- exact IPv4 and port.

Any advertised or signed identity mismatch fails closed and persists a visible `IDENTITY_WARNING` state. The extension never silently accepts a changed server identity.
