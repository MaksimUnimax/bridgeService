# BB2-DIRECT-11-EXT — browser trust and key-storage boundary

## Trust anchor

A Direct profile begins with a validated `BB2D1` bundle. The popup displays the exact IPv4, TCP port, server instance ID and SHA-256 fingerprint and requires an explicit operator confirmation before pairing.

The profile pins exact IPv4/port, server instance ID, server P-256 SPKI/fingerprint/rotation generation and paired device ID.

`GET /v2/bootstrap` is only an unauthenticated early mismatch signal. It never establishes server trust. A Direct profile becomes connected only after a valid signed `BB2D-L1` response verifies under the P-256 key pinned by the bundle and repeats the pinned instance/fingerprint.

## Device private key

Each Direct profile receives an independent browser-generated P-256 device keypair. Private material is stored only in `bb2_direct_private_keys` in `chrome.storage.local`; the service worker requests `TRUSTED_CONTEXTS`. Direct key/profile code is not loaded by the ChatGPT content script.

Public profile/UI objects expose only `has_private_key`, never PKCS8 or vault references. Diagnostics redact token/credential/secret/pairing/private-key/PKCS8 fields.

## Backup boundary

Legacy backup keeps its existing credential behavior and is explicitly marked secret. Direct private keys are excluded: `contains_direct_private_keys: false`, vault contents never exported and `key_ref` removed. Metadata restored without a matching local key becomes `NEEDS_REPAIR`.

## Network permission boundary

Legacy host permissions and local endpoint validator remain unchanged. Direct uses `optional_host_permissions`; `chrome.permissions.request` runs only from a user-initiated popup action for the selected IPv4 host. The Direct profile still pins and uses the exact bundle port.

## Lifecycle semantics

`status` and `revoke` are signed `BB2D-L1` requests. Responses must be signed, fresh and bound to action/device/request/instance/fingerprint.

`connect` is local only after successful signed status. `disconnect` is local and does not revoke. `revoke` is remote/signed/idempotent. `delete` removes local metadata/private key and requires explicit warning if remote state is ACTIVE. Identity mismatch or bad signature fails closed into `IDENTITY_WARNING`.

## Page-context isolation

Direct management messages are accepted only from trusted extension UI. Senders with a tab/content-script context are rejected for pair/status/connect/disconnect/rename/revoke/delete. No Direct device private key is sent to the page, content script or diagnostics.

## Run boundary

Run11 stops at profile/lifecycle management. `BB2-DIRECT-12-EXT` owns protected task/report transport, sessions, polling, cancellation and Legacy/Direct execution switching.
