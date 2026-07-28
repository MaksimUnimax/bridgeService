from __future__ import annotations

import json
import os
import pathlib
import socket
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace

from business_bridge_direct import __version__
from business_bridge_direct import config
from business_bridge_direct.database import check_database, initialize_database
from business_bridge_direct.http_api import BoundedIPv4Server, RateLimiter


LIMITS = {"request_timeout_seconds": 5, "max_request_line_bytes": 2048, "max_header_bytes": 8192, "max_header_count": 32, "max_request_body_bytes": 4096, "max_concurrent_requests": 16, "listen_backlog": 32, "per_source_rate_window_seconds": 10, "per_source_rate_limit": 30, "global_rate_window_seconds": 10, "global_rate_limit": 120}


def values(**changes: object) -> dict[str, object]:
    result: dict[str, object] = {"listen_host": "78.17.68.165", "listen_port": 18100, "database_path": "/var/lib/business-bridge-2-direct/bridge.sqlite3", "log_dir": "/var/log/business-bridge-2-direct", "service_name": "business-bridge-2-direct", "service_version": "0.3.0", **LIMITS}
    result.update(changes)
    return result


class DirectServiceTests(unittest.TestCase):
    def test_version_and_valid_exact_config(self) -> None:
        self.assertEqual(__version__, "0.3.0")
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "service.json"
            path.write_text(json.dumps(values()), encoding="utf-8"); os.chmod(path, 0o640)
            self.assertEqual(config.load_config(path).service_version, "0.3.0")

    def test_valid_wildcard_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "service.json"; path.write_text(json.dumps(values(listen_host="0.0.0.0"))); os.chmod(path, 0o640)
            self.assertEqual(config.load_config(path).listen_host, "0.0.0.0")

    def test_config_rejects_invalid_bind_port_paths_and_types(self) -> None:
        cases = [{"listen_host": "127.0.0.1"}, {"listen_host": "::"}, {"listen_host": "10.0.0.1"}, {"listen_port": 18083}, {"database_path": "/tmp/x"}, {"log_dir": "/tmp/x"}, {"request_timeout_seconds": 6}, {"max_request_line_bytes": 2049}, {"max_header_bytes": 8193}, {"max_header_count": 33}, {"max_request_body_bytes": 4097}, {"max_concurrent_requests": 17}, {"listen_backlog": 33}, {"per_source_rate_limit": 31}, {"global_rate_limit": 121}, {"listen_port": "18100"}]
        for change in cases:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                path = pathlib.Path(directory) / "service.json"; path.write_text(json.dumps(values(**change))); os.chmod(path, 0o640)
                with self.assertRaises(ValueError): config.load_config(path)

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
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
                self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("runtime_metadata",)])
                self.assertEqual(dict(connection.execute("SELECT key, value FROM runtime_metadata")), {"schema_version": "1", "service_version": "0.3.0"})
            self.assertTrue(check_database(str(path)))

    def _server(self, **changes: object):
        directory = tempfile.TemporaryDirectory(); path = pathlib.Path(directory.name) / "bridge.sqlite3"; initialize_database(str(path))
        service = SimpleNamespace(database_path=str(path), service_name="business-bridge-2-direct", version="0.3.0")
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
            for path, body in ((b"/v2/health", b'{"status":"ok","service":"business-bridge-2-direct","version":"0.3.0"}'), (b"/v2/version", b'{"service":"business-bridge-2-direct","version":"0.3.0","api_version":"v2","transport":"direct-http-bootstrap"}'), (b"/v2/diagnostics/public", b'{"service":"business-bridge-2-direct","version":"0.3.0","status":"ready","listener_scope":"public","database":"ready","identity":"not_configured","pairing":"disabled","crypto":"disabled","tasks":"disabled"}')):
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

    def test_invalid_schema_is_not_healthy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "invalid.sqlite3"; path.write_bytes(b"not sqlite"); self.assertFalse(check_database(str(path)))


if __name__ == "__main__": unittest.main()
