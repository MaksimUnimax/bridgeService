from __future__ import annotations

import io
import json
import os
import pathlib
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from business_bridge_direct import bundle
from business_bridge_direct import bundle_cli, pairing_cli
from business_bridge_direct.database import initialize_database, session_status
from business_bridge_direct.identity import IdentityError


SYNTETIC_IDENTITY = {
    "identity_version": 1,
    "instance_id": "11111111-1111-4111-8111-111111111111",
    "signing_algorithm": "ECDSA_P256_SHA256",
    "public_key_format": "SPKI_DER_BASE64URL",
    "public_key_spki": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdajsc0MKWPGn8JlAvd1iQTED8wgDHYF23Heq1sM-5eL61zFhKHewF9HoMsE3GCD2-ZOUa3z5XJS4rpGU9yCC0g",
    "fingerprint": "sha256:10a517a54a7fa625a2e46ad219e423e9e185b50c5b270c0e1755d457f2ce0fab",
    "created_at": "2026-07-30T00:00:00Z",
    "rotation_generation": 1,
    "previous_fingerprint": None,
    "rotated_at": None,
    "rotation_reason": None,
}


def _runtime(root: pathlib.Path) -> SimpleNamespace:
    return SimpleNamespace(
        listen_host="78.17.68.165",
        listen_port=18100,
        database_path=str(root / "state" / "bridge.sqlite3"),
        log_dir=str(root / "log"),
        service_name="business-bridge-2-direct",
        service_version="0.9.0",
        identity_metadata_path=str(root / "identity" / "identity.json"),
        server_signing_private_key_path=str(root / "secrets" / "server_signing_private_key.pem"),
        openssl_path="/usr/bin/openssl",
        request_timeout_seconds=5,
        max_request_line_bytes=2048,
        max_header_bytes=8192,
        max_header_count=32,
        max_request_body_bytes=4096,
        max_concurrent_requests=16,
        listen_backlog=32,
        per_source_rate_window_seconds=10,
        per_source_rate_limit=30,
        global_rate_window_seconds=10,
        global_rate_limit=120,
        max_task_payload_bytes=2048,
        max_task_nesting_depth=8,
        max_task_string_bytes=512,
        max_task_collection_items=64,
    )


class BundleCliTests(unittest.TestCase):
    def _temp_root(self) -> tuple[tempfile.TemporaryDirectory, pathlib.Path, SimpleNamespace]:
        temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(temp.name)
        (root / "state").mkdir()
        return temp, root, _runtime(root)

    def _patch_runtime(self, runtime: SimpleNamespace, identity: dict[str, object] | None = None):
        identity = identity or SYNTETIC_IDENTITY
        return mock.patch.multiple(
            bundle_cli,
            load_config=mock.Mock(return_value=runtime),
            validate_identity=mock.Mock(return_value=identity),
            grp=mock.Mock(getgrnam=mock.Mock(return_value=SimpleNamespace(gr_gid=0))),
        )

    def test_success_outputs_one_bundle_line(self) -> None:
        temp, root, runtime = self._temp_root()
        try:
            initialize_database(runtime.database_path)
            with self._patch_runtime(runtime):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", stdout), mock.patch.object(bundle_cli.sys, "stderr", stderr):
                    rc = bundle_cli.main(["create", "--ttl", "600"])
            self.assertEqual(rc, 0)
            self.assertEqual(stderr.getvalue(), "")
            self.assertTrue(stdout.getvalue().endswith("\n"))
            self.assertEqual(stdout.getvalue().count("\n"), 1)
            decoded = bundle.decode_bundle(stdout.getvalue().strip(), now="2026-07-30T00:00:00Z")
            self.assertEqual(decoded["bundle_version"], "BB2D1")
            self.assertEqual(decoded["host"], runtime.listen_host)
            self.assertEqual(decoded["port"], runtime.listen_port)
            with sqlite3.connect(runtime.database_path) as c:
                status = c.execute("SELECT status FROM pairing_sessions").fetchone()[0]
                dump = "\n".join(c.iterdump())
                stored_session_id = c.execute("SELECT session_id FROM pairing_sessions").fetchone()[0]
            self.assertEqual(status, "ACTIVE")
            self.assertNotIn(decoded["pairing_code"], dump)
            self.assertEqual(decoded["pairing_session_id"], stored_session_id)
            self.assertEqual(bundle.decode_bundle(stdout.getvalue().strip(), now="2026-07-30T00:00:00Z")["pairing_code"], decoded["pairing_code"])
        finally:
            temp.cleanup()

    def test_invalid_ttl_fails_before_session_creation(self) -> None:
        temp, _, runtime = self._temp_root()
        try:
            with self._patch_runtime(runtime):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", stdout), mock.patch.object(bundle_cli.sys, "stderr", stderr):
                    rc = bundle_cli.main(["create", "--ttl", "299"])
            self.assertEqual(rc, 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), '{"error":"bundle_creation_failed"}\n')
            self.assertFalse(pathlib.Path(runtime.database_path).exists())
        finally:
            temp.cleanup()

    def test_invalid_identity_fails_before_session_creation(self) -> None:
        temp, _, runtime = self._temp_root()
        try:
            with mock.patch.multiple(
                bundle_cli,
                load_config=mock.Mock(return_value=runtime),
                validate_identity=mock.Mock(side_effect=IdentityError("IDENTITY_FINGERPRINT_MISMATCH")),
                grp=mock.Mock(getgrnam=mock.Mock(return_value=SimpleNamespace(gr_gid=0))),
            ):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", stdout), mock.patch.object(bundle_cli.sys, "stderr", stderr):
                    rc = bundle_cli.main(["create", "--ttl", "600"])
            self.assertEqual(rc, 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), '{"error":"bundle_creation_failed"}\n')
            self.assertFalse(pathlib.Path(runtime.database_path).exists())
        finally:
            temp.cleanup()

    def test_encode_failure_revokes_session(self) -> None:
        temp, root, runtime = self._temp_root()
        try:
            with self._patch_runtime(runtime):
                with mock.patch("business_bridge_direct.bundle.encode_bundle", side_effect=RuntimeError("boom")):
                    stdout = io.StringIO()
                    stderr = io.StringIO()
                    with mock.patch.object(bundle_cli.sys, "stdout", stdout), mock.patch.object(bundle_cli.sys, "stderr", stderr):
                        rc = bundle_cli.main(["create", "--ttl", "600"])
            self.assertEqual(rc, 1)
            self.assertEqual(stderr.getvalue(), '{"error":"bundle_creation_failed"}\n')
            with sqlite3.connect(runtime.database_path) as c:
                status = c.execute("SELECT status FROM pairing_sessions").fetchone()[0]
            self.assertNotEqual(status, "ACTIVE")
        finally:
            temp.cleanup()

    def test_broken_pipe_revokes_session(self) -> None:
        temp, root, runtime = self._temp_root()
        try:
            class BrokenStdout:
                def write(self, _data: str) -> int:
                    raise BrokenPipeError

                def flush(self) -> None:
                    return None

            with self._patch_runtime(runtime):
                stdout = BrokenStdout()
                stderr = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", stdout), mock.patch.object(bundle_cli.sys, "stderr", stderr):
                    rc = bundle_cli.main(["create", "--ttl", "600"])
            self.assertEqual(rc, 1)
            self.assertEqual(stderr.getvalue(), '{"error":"bundle_creation_failed"}\n')
            with sqlite3.connect(runtime.database_path) as c:
                status = c.execute("SELECT status FROM pairing_sessions").fetchone()[0]
            self.assertNotEqual(status, "ACTIVE")
        finally:
            temp.cleanup()

    def _run_output_failure(self, stdout_object) -> tuple[int, str, str, str]:
        temp, _, runtime = self._temp_root()
        try:
            with self._patch_runtime(runtime):
                stderr = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", stdout_object), mock.patch.object(bundle_cli.sys, "stderr", stderr):
                    rc = bundle_cli.main(["create", "--ttl", "600"])
            with sqlite3.connect(runtime.database_path) as c:
                status = c.execute("SELECT status FROM pairing_sessions").fetchone()[0]
            return rc, getattr(stdout_object, "value", lambda: "")(), stderr.getvalue(), status
        finally:
            temp.cleanup()

    def test_short_zero_and_none_writes_revoke(self) -> None:
        class Short:
            def __init__(self, result): self.result = result; self.data = ""
            def write(self, data): self.data += data; return self.result
            def flush(self): return None
            def value(self): return self.data
        for result in (0, None):
            rc, _out, err, status = self._run_output_failure(Short(result))
            self.assertEqual((rc, err), (1, '{"error":"bundle_creation_failed"}\n'))
            self.assertNotEqual(status, "ACTIVE")

    def test_flush_failure_revoke(self) -> None:
        class FlushFailure:
            def __init__(self): self.data = ""
            def write(self, data): self.data += data; return len(data)
            def flush(self): raise OSError("flush failed")
            def value(self): return self.data
        rc, _out, err, status = self._run_output_failure(FlushFailure())
        self.assertEqual((rc, err), (1, '{"error":"bundle_creation_failed"}\n'))
        self.assertNotEqual(status, "ACTIVE")

    def test_cleanup_retries_transient_revoke_and_status(self) -> None:
        temp, _, runtime = self._temp_root()
        try:
            real_revoke = bundle_cli.revoke_session
            real_status = bundle_cli.session_status
            revoke_calls = mock.Mock(side_effect=[sqlite3.OperationalError("database is locked"), lambda *args: real_revoke(*args), lambda *args: real_revoke(*args)])
            status_calls = mock.Mock(side_effect=[sqlite3.OperationalError("database is busy"), lambda *args: real_status(*args)])
            with self._patch_runtime(runtime), mock.patch.object(bundle_cli, "revoke_session", revoke_calls), mock.patch.object(bundle_cli, "session_status", status_calls):
                class Broken:
                    def write(self, _data): raise BrokenPipeError
                    def flush(self): return None
                out = Broken(); err = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", out), mock.patch.object(bundle_cli.sys, "stderr", err):
                    rc = bundle_cli.main(["create", "--ttl", "600"])
            self.assertEqual(rc, 1)
            self.assertEqual(err.getvalue(), '{"error":"bundle_creation_failed"}\n')
            self.assertGreaterEqual(revoke_calls.call_count, 2)
            self.assertGreaterEqual(status_calls.call_count, 2)
        finally:
            temp.cleanup()

    def test_cleanup_failure_never_reports_success(self) -> None:
        temp, _, runtime = self._temp_root()
        try:
            with self._patch_runtime(runtime), mock.patch.object(bundle_cli, "revoke_session", side_effect=sqlite3.OperationalError("database is locked")), mock.patch.object(bundle_cli, "session_status", side_effect=sqlite3.OperationalError("database is locked")), mock.patch("business_bridge_direct.bundle.encode_bundle", side_effect=RuntimeError("boom")):
                out = io.StringIO(); err = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", out), mock.patch.object(bundle_cli.sys, "stderr", err):
                    rc = bundle_cli.main(["create", "--ttl", "600"])
            self.assertEqual(rc, 1)
            self.assertEqual(err.getvalue(), '{"error":"bundle_creation_failed"}\n')
            with sqlite3.connect(runtime.database_path) as c:
                self.assertEqual(c.execute("SELECT status FROM pairing_sessions").fetchone()[0], "ACTIVE")
        finally:
            temp.cleanup()

    def test_parser_contract_for_malformed_arguments(self) -> None:
        cases = [[], ["wat"], ["create", "--unknown"], ["create", "--ttl", "abc"], ["create", "--config"], ["create", "--ttl", "299"], ["create", "--ttl", "601"]]
        for argv in cases:
            with self.subTest(argv=argv):
                out = io.StringIO(); err = io.StringIO()
                with mock.patch.object(bundle_cli.sys, "stdout", out), mock.patch.object(bundle_cli.sys, "stderr", err):
                    rc = bundle_cli.main(argv)
                self.assertEqual(rc, 1)
                self.assertEqual(out.getvalue(), "")
                self.assertEqual(err.getvalue(), '{"error":"bundle_creation_failed"}\n')
                self.assertNotIn("usage", err.getvalue().lower())

    def test_help_is_non_mutating(self) -> None:
        out = io.StringIO(); err = io.StringIO()
        with mock.patch.object(bundle_cli.sys, "stdout", out), mock.patch.object(bundle_cli.sys, "stderr", err):
            with self.assertRaises(SystemExit) as cm:
                bundle_cli.main(["--help"])
        self.assertEqual(cm.exception.code, 0)
        self.assertIn("usage:", out.getvalue())
        self.assertEqual(err.getvalue(), "")

    def test_existing_pairing_cli_output_unchanged(self) -> None:
        temp, _, runtime = self._temp_root()
        try:
            initialize_database(runtime.database_path)
            with mock.patch("business_bridge_direct.config.load_config", return_value=runtime):
                out = io.StringIO()
                with mock.patch("sys.stdout", out):
                    rc = pairing_cli.main(["create", "--ttl", "600"])
            self.assertEqual(rc, 0)
            data = json.loads(out.getvalue())
            self.assertEqual(set(data), {"session_id", "pairing_code", "expires_at"})
        finally:
            temp.cleanup()
