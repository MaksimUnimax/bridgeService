from __future__ import annotations

import json
import os
import pathlib
import socket
import stat
import subprocess
import shutil
import tempfile
import threading
import time
import unittest
import sys
from types import SimpleNamespace

from business_bridge_direct import __version__
from business_bridge_direct import config
from business_bridge_direct.database import check_database, initialize_database
from business_bridge_direct.http_api import BoundedIPv4Server, RateLimiter
from business_bridge_direct.identity import IdentityError, init_identity, validate_identity


LIMITS = {"request_timeout_seconds": 5, "max_request_line_bytes": 2048, "max_header_bytes": 8192, "max_header_count": 32, "max_request_body_bytes": 4096, "max_concurrent_requests": 16, "listen_backlog": 32, "per_source_rate_window_seconds": 10, "per_source_rate_limit": 30, "global_rate_window_seconds": 10, "global_rate_limit": 120, "max_task_payload_bytes": 2048, "max_task_nesting_depth": 8, "max_task_string_bytes": 512, "max_task_collection_items": 64, "identity_metadata_path": "/var/lib/business-bridge-2-direct/identity/identity.json", "server_signing_private_key_path": "/etc/business-bridge-2-direct/secrets/server_signing_private_key.pem", "openssl_path": "/usr/bin/openssl"}


def values(**changes: object) -> dict[str, object]:
    result: dict[str, object] = {"listen_host": "78.17.68.165", "listen_port": 18100, "database_path": "/var/lib/business-bridge-2-direct/bridge.sqlite3", "log_dir": "/var/log/business-bridge-2-direct", "service_name": "business-bridge-2-direct", "service_version": "0.9.0", **LIMITS}
    result.update(changes)
    return result


class DirectServiceTests(unittest.TestCase):
    def _identity_config(self, root: pathlib.Path):
        data = values(database_path=str(root / "bridge.sqlite3"), identity_metadata_path=str(root / "identity" / "identity.json"), server_signing_private_key_path=str(root / "secrets" / "server_signing_private_key.pem"))
        (root / "identity").mkdir(); (root / "secrets").mkdir(); os.chmod(root / "identity", 0o750); os.chmod(root / "secrets", 0o750)
        from types import SimpleNamespace
        return SimpleNamespace(**data)

    def test_identity_init_idempotency_and_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cfg = self._identity_config(pathlib.Path(directory)); first, result = init_identity(cfg, os.getgid()); self.assertEqual(result, "created")
            key = pathlib.Path(cfg.server_signing_private_key_path); metadata = pathlib.Path(cfg.identity_metadata_path)
            before = (key.read_bytes(), metadata.read_bytes()); second, result = init_identity(cfg, os.getgid())
            self.assertEqual(result, "unchanged"); self.assertEqual(first["instance_id"], second["instance_id"]); self.assertEqual(before, (key.read_bytes(), metadata.read_bytes()))
            metadata.write_text(metadata.read_text().replace(first["fingerprint"], "sha256:" + "0" * 64)); os.chmod(metadata, 0o640)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())

    def test_identity_validation_uses_private_process_scratch_as_service_user(self) -> None:
        if os.geteuid() != 0:
            self.skipTest("requires root to establish the production-equivalent ownership boundary")
        service_uid = 995
        service_gid = 995
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); cfg = self._identity_config(root)
            for parent in (pathlib.Path(cfg.server_signing_private_key_path).parent, pathlib.Path(cfg.identity_metadata_path).parent):
                os.chown(parent, 0, service_gid)
            init_identity(cfg, service_gid)
            for parent in (pathlib.Path(cfg.server_signing_private_key_path).parent, pathlib.Path(cfg.identity_metadata_path).parent):
                os.chown(parent, 0, service_gid); os.chmod(parent, 0o750)
            tmp_root = root / "process-tmp"; tmp_root.mkdir(); os.chown(tmp_root, 0, 0); os.chmod(tmp_root, 0o733)
            os.chmod(root, 0o755)
            source_root = pathlib.Path(tempfile.mkdtemp(prefix="bb2-test-source-", dir="/var/tmp")); shutil.copytree(pathlib.Path(__file__).parents[2] / "server/src/business_bridge_direct", source_root / "business_bridge_direct")
            os.chmod(source_root, 0o755); os.chmod(source_root / "business_bridge_direct", 0o755)
            for source_file in (source_root / "business_bridge_direct").iterdir():
                if source_file.is_file(): os.chmod(source_file, 0o644)
            before_key = sorted(pathlib.Path(cfg.server_signing_private_key_path).parent.iterdir())
            before_meta = sorted(pathlib.Path(cfg.identity_metadata_path).parent.iterdir())
            script = """import os\nfrom types import SimpleNamespace\nfrom business_bridge_direct.identity import validate_identity\ncfg=SimpleNamespace(server_signing_private_key_path=os.environ['BB_KEY'], identity_metadata_path=os.environ['BB_META'], openssl_path='/usr/bin/openssl')\ndata=validate_identity(cfg, int(os.environ['BB_GID']))\nassert data['rotation_generation'] == 1\nprint('ok')\n"""
            venv_site_packages = pathlib.Path(sys.prefix) / "lib/python3.11/site-packages"
            env = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "PYTHONPATH": str(source_root) + ":" + str(venv_site_packages), "TMPDIR": str(tmp_root), "BB_KEY": cfg.server_signing_private_key_path, "BB_META": cfg.identity_metadata_path, "BB_GID": str(service_gid)}
            result = subprocess.run(["runuser", "-u", "business-bridge-direct", "--", "env", *[f"{key}={value}" for key, value in env.items()], "/usr/bin/python3.11", "-c", script], text=True, capture_output=True, check=False)
            shutil.rmtree(source_root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "ok")
            self.assertEqual(before_key, sorted(pathlib.Path(cfg.server_signing_private_key_path).parent.iterdir()))
            self.assertEqual(before_meta, sorted(pathlib.Path(cfg.identity_metadata_path).parent.iterdir()))
            leftovers = [p for p in tmp_root.iterdir() if p.name.startswith("bb2-id-")]
            self.assertEqual(leftovers, [])
            for parent in (pathlib.Path(cfg.server_signing_private_key_path).parent, pathlib.Path(cfg.identity_metadata_path).parent):
                self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o750)

    def test_identity_partial_symlink_permissions_and_metadata_rules(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); cfg = self._identity_config(root); init_identity(cfg, os.getgid()); key = pathlib.Path(cfg.server_signing_private_key_path); meta = pathlib.Path(cfg.identity_metadata_path)
            os.chmod(key, 0o644)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())
            os.chmod(key, 0o640); moved = root / "moved"; key.rename(moved); key.symlink_to(moved)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())
            key.unlink();
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())

    def test_identity_fail_closed_cases_and_public_only_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); cfg = self._identity_config(root); init_identity(cfg, os.getgid())
            key = pathlib.Path(cfg.server_signing_private_key_path); meta = pathlib.Path(cfg.identity_metadata_path)
            original = meta.read_text()
            for bad in (original.replace('"rotation_generation":1', '"rotation_generation":2'), original.replace('"rotation_reason":null', '"unexpected":null,"rotation_reason":null'), original.replace('"rotation_reason":null', '"rotation_reason":"x"'), original.replace('"created_at":"', '"created_at":"not-')):
                meta.write_text(bad); os.chmod(meta, 0o640)
                with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())
            meta.write_text(original); os.chmod(meta, 0o640)
            os.chmod(key, 0o660)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())
            os.chmod(key, 0o640)
            linked = root / "key-link"; os.link(key, linked)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())
            linked.unlink()
            key.rename(root / "moved-key"); key.symlink_to(root / "moved-key")
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())
            source = (pathlib.Path(__file__).parents[2] / "server/src/business_bridge_direct/identity.py").read_text()
            self.assertNotIn('"pkey", "-in", str(key), "-text"', source)

    def test_identity_boundary_rejects_symlink_and_hardlink_metadata(self) -> None:
        if os.geteuid() != 0:
            self.skipTest("requires root for ownership boundary")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); cfg = self._identity_config(root); init_identity(cfg, os.getgid())
            identity_dir = pathlib.Path(cfg.identity_metadata_path).parent
            metadata = pathlib.Path(cfg.identity_metadata_path)
            moved = root / "metadata-copy"; metadata.rename(moved); metadata.symlink_to(moved)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())
            metadata.unlink(); os.link(moved, metadata)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())

    def test_identity_boundary_rejects_non_root_or_wrong_mode_parent(self) -> None:
        if os.geteuid() != 0:
            self.skipTest("requires root for ownership boundary")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); cfg = self._identity_config(root); init_identity(cfg, os.getgid())
            identity_dir = pathlib.Path(cfg.identity_metadata_path).parent
            os.chmod(identity_dir, 0o770)
            with self.assertRaises(IdentityError): validate_identity(cfg, os.getgid())

    def test_real_bootstrap_http_contract_and_determinism(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); cfg = self._identity_config(root); identity, result = init_identity(cfg, os.getgid()); self.assertEqual(result, "created")
            db = root / "bridge.sqlite3"; initialize_database(str(db))
            service = SimpleNamespace(database_path=str(db), service_name="business-bridge-2-direct", version="0.6.0", identity=identity)
            cfg.database_path = str(db)
            server = BoundedIPv4Server(("127.0.0.1", 0), service, cfg); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                response = self._raw(server, b"GET /v2/bootstrap HTTP/1.1\r\nHost: test\r\n\r\n")
                self.assertIn(b"HTTP/1.1 200", response); body = json.loads(response.split(b"\r\n\r\n", 1)[1])
                self.assertEqual(tuple(body), ("service", "version", "api_version", "bootstrap_version", "instance_id", "server_signing_algorithm", "server_public_key_format", "server_public_key", "server_fingerprint", "rotation_generation"))
                self.assertEqual(body["instance_id"], identity["instance_id"]); self.assertEqual(body["server_fingerprint"], identity["fingerprint"])
                self.assertEqual(response, self._raw(server, b"GET /v2/bootstrap HTTP/1.1\r\nHost: test\r\n\r\n"))
                self.assertIn(b"HTTP/1.1 405", self._raw(server, b"POST /v2/bootstrap HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\n\r\n"))
            finally:
                server.shutdown(); thread.join(2); server.server_close()
    def test_version_and_valid_exact_config(self) -> None:
        self.assertEqual(__version__, "0.9.0")
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "service.json"
            path.write_text(json.dumps(values()), encoding="utf-8"); os.chmod(path, 0o640)
            self.assertEqual(config.load_config(path).service_version, "0.9.0")

    def test_valid_wildcard_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "service.json"; path.write_text(json.dumps(values(listen_host="0.0.0.0"))); os.chmod(path, 0o640)
            with self.assertRaises(ValueError): config.load_config(path)

    def test_config_rejects_invalid_bind_port_paths_and_types(self) -> None:
        cases = [{"listen_host": "127.0.0.1"}, {"listen_host": "::"}, {"listen_host": "10.0.0.1"}, {"listen_port": 18083}, {"database_path": "/tmp/x"}, {"log_dir": "/tmp/x"}, {"request_timeout_seconds": 6}, {"max_request_line_bytes": 2049}, {"max_header_bytes": 8193}, {"max_header_count": 33}, {"max_request_body_bytes": 4097}, {"max_concurrent_requests": 17}, {"listen_backlog": 33}, {"per_source_rate_limit": 31}, {"global_rate_limit": 121}, {"listen_port": "18100"}]
        for change in cases:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                path = pathlib.Path(directory) / "service.json"; path.write_text(json.dumps(values(**change))); os.chmod(path, 0o640)
                with self.assertRaises(ValueError): config.load_config(path)

    def test_config_accepts_only_exact_nested_identity_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); path = root / "service.json"
            for candidate in (
                "/var/lib/business-bridge-2-direct/identity.json",
                "/var/lib/business-bridge-2-direct/other/identity.json",
                "var/lib/business-bridge-2-direct/identity/identity.json",
            ):
                path.write_text(json.dumps(values(identity_metadata_path=candidate))); os.chmod(path, 0o640)
                with self.assertRaises(ValueError): config.load_config(path)
            path.write_text(json.dumps(values())); os.chmod(path, 0o640)
            self.assertEqual(config.load_config(path).identity_metadata_path, "/var/lib/business-bridge-2-direct/identity/identity.json")

    def test_config_rejects_unknown_missing_symlink_and_unsafe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); path = root / "service.json"; path.write_text(json.dumps(values())); os.chmod(path, 0o640)
            for data in ({**values(), "extra": 1}, {key: value for key, value in values().items() if key != "listen_backlog"}, {}):
                path.write_text(json.dumps(data));
                with self.assertRaises(ValueError): config.load_config(path)
            target = root / "target"; target.write_text(json.dumps(values())); link = root / "link"; link.symlink_to(target)
            with self.assertRaises(ValueError): config.load_config(link)
            path.write_text(json.dumps(values())); os.chmod(path, 0o666)
            with self.assertRaises(ValueError): config.load_config(path)

    def test_database_schema_and_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "bridge.sqlite3"; initialize_database(str(path)); initialize_database(str(path))
            import sqlite3
            with sqlite3.connect(path) as connection:
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
                names = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertTrue({"runtime_metadata", "pairing_sessions", "paired_devices", "pairing_audit_events"} <= names)
                self.assertEqual(dict(connection.execute("SELECT key, value FROM runtime_metadata")), {"schema_version": "5", "service_version": "0.9.0"})
            self.assertTrue(check_database(str(path)))

    def _server(self, **changes: object):
        directory = tempfile.TemporaryDirectory(); path = pathlib.Path(directory.name) / "bridge.sqlite3"; initialize_database(str(path))
        service = SimpleNamespace(database_path=str(path), service_name="business-bridge-2-direct", version="0.9.0", identity={"instance_id":"00000000-0000-4000-8000-000000000000", "signing_algorithm":"ECDSA_P256_SHA256", "public_key_format":"SPKI_DER_BASE64URL", "public_key_spki":"AQ", "fingerprint":"sha256:" + "0" * 64, "rotation_generation":1})
        cfg_values = values(**changes); cfg_values["database_path"] = str(path)
        cfg = SimpleNamespace(**cfg_values)
        server = BoundedIPv4Server(("127.0.0.1", 0), service, cfg); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        return directory, server, thread

    def _raw(self, server: BoundedIPv4Server, request: bytes, timeout: float = 2) -> bytes:
        with socket.create_connection(server.server_address, timeout=timeout) as sock:
            sock.sendall(request); sock.shutdown(socket.SHUT_WR); return sock.recv(20000)

    def test_exact_public_contracts_headers_and_connection_close(self) -> None:
        directory, server, thread = self._server()
        try:
            for path, body in ((b"/v2/health", b'{"status":"ok","service":"business-bridge-2-direct","version":"0.9.0"}'), (b"/v2/version", b'{"service":"business-bridge-2-direct","version":"0.9.0","api_version":"v2","transport":"direct-http-bootstrap"}'), (b"/v2/diagnostics/public", b'{"service":"business-bridge-2-direct","version":"0.9.0","status":"ready","listener_scope":"public","database":"ready","identity":"ready","pairing":"enabled","crypto":"BB2D-P1","tasks":"enabled"}')):
                response = self._raw(server, b"GET " + path + b" HTTP/1.1\r\nHost: test\r\n\r\n"); self.assertIn(b"HTTP/1.1 200", response); self.assertTrue(response.endswith(body)); self.assertIn(b"Connection: close", response); self.assertIn(b"Content-Length: " + str(len(body)).encode(), response)
            self.assertIn(b"HTTP/1.1 404", self._raw(server, b"GET /unknown HTTP/1.1\r\nHost: test\r\n\r\n"))
            self.assertIn(b"HTTP/1.1 405", self._raw(server, b"POST /v2/health HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\n\r\n"))
        finally: server.shutdown(); thread.join(2); server.server_close(); directory.cleanup()

    def test_request_limits_and_safe_errors(self) -> None:
        directory, server, thread = self._server()
        try:
            self.assertIn(b"HTTP/1.1 414", self._raw(server, b"GET /" + b"x" * 2048 + b" HTTP/1.1\r\nHost: test\r\n\r\n"))
            self.assertIn(b"HTTP/1.1 431", self._raw(server, b"GET /v2/health HTTP/1.1\r\nX-A: " + b"x" * 8200 + b"\r\n\r\n"))
            headers = b"".join(b"X-%d: x\r\n" % i for i in range(33)); self.assertIn(b"HTTP/1.1 431", self._raw(server, b"GET /v2/health HTTP/1.1\r\n" + headers + b"\r\n"))
            self.assertIn(b"HTTP/1.1 413", self._raw(server, b"POST /v2/health HTTP/1.1\r\nContent-Length: 4097\r\n\r\n"))
            self.assertIn(b"HTTP/1.1 400", self._raw(server, b"BROKEN\r\n\r\n"))
            self.assertNotIn(b"BROKEN", self._raw(server, b"GET /secret?BROKEN HTTP/1.1\r\nHost: test\r\n\r\n"))
        finally: server.shutdown(); thread.join(2); server.server_close(); directory.cleanup()

    def test_rate_limiter_bounded_and_expired(self) -> None:
        now = [0.0]; limiter = RateLimiter(lambda: now[0], max_sources=2)
        self.assertTrue(limiter.allow("a", 10, 1, 10, 10)); self.assertFalse(limiter.allow("a", 10, 1, 10, 10)); now[0] = 11; limiter.cleanup(10); self.assertTrue(limiter.allow("a", 10, 1, 10, 10)); limiter.allow("b", 10, 1, 10, 10); limiter.allow("c", 10, 1, 10, 10); self.assertLessEqual(len(limiter.sources), 2)

    def test_listener_allows_controlled_restart_after_time_wait(self) -> None:
        self.assertTrue(BoundedIPv4Server.allow_reuse_address)

    def test_invalid_schema_is_not_healthy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "invalid.sqlite3"; path.write_bytes(b"not sqlite"); self.assertFalse(check_database(str(path)))


if __name__ == "__main__": unittest.main()
