# BB2-DIRECT-08-SRV acceptance evidence

Technical ID `BB2-DIRECT-08-SRV`, parent run `BB2-DIRECT-08`, attempt `13`.
All evidence is redacted to statuses, counts and hashes; it contains no keys,
pairing codes, traffic material, ciphertext or user payload.

## Defect ledger

Attempt 12 exposed a PROCESS defect. The `wrong_signature` case received the
generic pre-auth response `{"error":"authentication_failed"}`, while the
harness unconditionally parsed every response as an encrypted response
envelope and raised `response_envelope_fields`. The corrected harness now
accepts only a strict one-field generic JSON error for pre-authentication or
decryption rejection, and reserves response-envelope verification for
authenticated application errors. Server runtime was not changed.

The related server-signature harness check was corrected to verify the signed
envelope without its signature field; this restores the required authenticated
signature check and does not change protocol/runtime bytes.

## Candidate and preserved bytes

- Implementation candidate: `ba9614dcd722fd77bf118f78427737f85bed2f6c`
- Parent: `517dd10166ef1014dec3a3ef9fab49deadc0d51f`
- Candidate tree: `cb0779a8ff59d6071fec36fa2c163ea999e62830`
- Attempt-12 server/runtime, migration, manifest and vector blobs: identical.
- Browser vector SHA-256: `a79ed27626ec3730bacfdee4edbdb803fa53e7bf72647d8d0a3c60e547ddda9e`.
- Clean wheel verification SHA-256: `142764858e13896b7e74186e9f2a519b0e1d82f5b70cbd16b86daf62dfa8e7a8`.

## Gates

Compileall, protocol tests, server tests, vector verification, manifest
verification, wheel metadata/RECORD/ZIP validation and secret scan passed.
Reused gates were vector fixture/determinism, manifest regeneration and wheel
member/metadata validation; supporting hashes are recorded in `RESULTS.json`.
The clean wheel build was independently rerun with the attempt-12 toolchain
and matched the authoritative hash.

Source and installed-wheel TCP acceptance passed: pairing, session, immediate
create, exact/reordered duplicate, payload conflict, status, report and
repeat-report identity, single execution, pending task, cancel/repeat cancel,
cancelled status, unavailable report, revoke and revoked-device rejection.
The pre-auth matrix produced strict generic JSON errors with no envelope
parsing; authenticated application cases produced signed/encrypted
`task_error` responses with status-bound AAD and successful decryption.

Rollback rehearsal passed in isolated test boundaries: Direct-only staging,
database migration rollback, SQLite integrity/foreign-key checks, identity
preservation, symlink/hardlink/resolved-path escape rejection and unchanged
system Python. No Legacy action was performed.

Production package comparison found zero differing runtime members, so package
mutation was `NO` and Direct restart was `NO`. Production TCP acceptance and
synthetic cleanup passed; final Direct and Legacy health checks are HTTP 200.

Chromium/Web Crypto verification is `DEFERRED_TO_CHATGPT`.
