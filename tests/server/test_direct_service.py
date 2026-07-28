from __future__ import annotations

import json
import os
import pathlib
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from business_bridge_direct import __version__
from business_bridge_direct import config
from business_bridge_direct.database import check_database, initialize_database
from business_bridge_direct.http_api import DirectHTTPServer


class DirectServiceTests(unittest.TestCase):
    def test_version_and_config(self) -> None:
        self.assertEqual(__version__, "0.2.0")
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "service.json"
            path.write_text(json.dumps({"listen_host": "127.0.0.1", "listen_port": 18100, "database_path": "/var/lib/business-bridge-2-direct/bridge.sqlite3", "log_dir": "/var/log/business-bridge-2-direct", "service_name": "business-bridge-2-direct", "service_version": "0.2.0"}), encoding="utf-8")
            os.chmod(path, 0o640)
            loaded = config.load_config(path)
            self.assertEqual(loaded.service_version, "0.2.0")
            path.write_text("{}", encoding="utf-8")
            with self.assertRaises(ValueError):
                config.load_config(path)

    def test_config_rejects_unsafe_values(self) -> None:
        cases = [
            {"listen_host": "0.0.0.0"},
            {"listen_port": 0},
            {"database_path": "/tmp/foreign.sqlite3"},
            {"log_dir": "/tmp/logs"},
        ]
        for change in cases:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                values = {"listen_host": "127.0.0.1", "listen_port": 18100, "database_path": "/var/lib/business-bridge-2-direct/bridge.sqlite3", "log_dir": "/var/log/business-bridge-2-direct", "service_name": "business-bridge-2-direct", "service_version": "0.2.0"}
                values.update(change)
                path = pathlib.Path(directory) / "service.json"
                path.write_text(json.dumps(values), encoding="utf-8")
                os.chmod(path, 0o640)
                with self.assertRaises(ValueError):
                    config.load_config(path)

    def test_config_rejects_symlink_and_world_writable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "target"
            target.write_text("{}", encoding="utf-8")
            link = root / "link"
            link.symlink_to(target)
            with self.assertRaises(ValueError):
                config.load_config(link)
            os.chmod(target, 0o666)
            with self.assertRaises(ValueError):
                config.load_config(target)

    def test_database_exact_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "bridge.sqlite3"
            initialize_database(str(path))
            initialize_database(str(path))
            import sqlite3
            with sqlite3.connect(path) as connection:
                self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
                self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("runtime_metadata",)])
                self.assertEqual(dict(connection.execute("SELECT key, value FROM runtime_metadata")), {"schema_version": "1", "service_version": "0.2.0"})
            self.assertTrue(check_database(str(path)))

    def test_http_surface_and_redaction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "bridge.sqlite3"
            initialize_database(str(path))
            service = type("Service", (), {"database_path": str(path), "service_name": "business-bridge-2-direct", "version": "0.2.0"})()
            server = DirectHTTPServer(("127.0.0.1", 0), service)
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            base = "http://127.0.0.1:%d" % server.server_address[1]
            try:
                expected = {
                    "/v2/health": {"status": "ok", "service": "business-bridge-2-direct", "version": "0.2.0"},
                    "/v2/version": {"service": "business-bridge-2-direct", "version": "0.2.0", "api_version": "v2", "transport": "localhost-http"},
                    "/v2/diagnostics/public": {"service": "business-bridge-2-direct", "version": "0.2.0", "status": "ready", "listener_scope": "localhost", "database": "ready", "identity": "not_configured", "pairing": "disabled", "crypto": "disabled", "tasks": "disabled"},
                }
                for route, body in expected.items():
                    with urllib.request.urlopen(base + route + "?secret=redacted") as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(json.load(response), body)
                        self.assertIn("no-store", response.headers["Cache-Control"])
                        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                        self.assertNotIn("Python", response.headers.get("Server", ""))
                with self.assertRaises(urllib.error.HTTPError) as not_found:
                    urllib.request.urlopen(base + "/v2/unknown")
                self.assertEqual(not_found.exception.code, 404)
                request = urllib.request.Request(base + "/v2/health", method="POST")
                with self.assertRaises(urllib.error.HTTPError) as method_error:
                    urllib.request.urlopen(request)
                self.assertEqual(method_error.exception.code, 405)
            finally:
                server.shutdown()
                thread.join(timeout=2)
                server.server_close()

    def test_invalid_schema_is_not_healthy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "invalid.sqlite3"
            path.write_bytes(b"not sqlite")
            self.assertFalse(check_database(str(path)))


if __name__ == "__main__":
    unittest.main()
