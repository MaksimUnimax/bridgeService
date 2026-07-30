from __future__ import annotations

import importlib
import hashlib
import json
import os
import pathlib
import pkgutil
import socket
import sqlite3
import subprocess
import sys
import unittest



ROOT = pathlib.Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"
PACKAGE = SERVER / "src" / "business_bridge_direct"
MANIFEST = SERVER / "FILE_MANIFEST.sha256"


class BaselineTests(unittest.TestCase):
  def test_identity_and_defaults(self) -> None:
    import business_bridge_direct
    self.assertIn('name = "business-bridge-2-direct"', (SERVER / "pyproject.toml").read_text(encoding="utf-8"))
    self.assertEqual(business_bridge_direct.__name__, "business_bridge_direct")
    self.assertNotEqual(business_bridge_direct.__name__, "app")
    defaults = business_bridge_direct.DirectDefaults()
    self.assertEqual(defaults.__dict__, {
        "install_dir": "/opt/business-bridge-2-direct",
        "config_dir": "/etc/business-bridge-2-direct",
        "secrets_dir": "/etc/business-bridge-2-direct/secrets",
        "state_dir": "/var/lib/business-bridge-2-direct",
        "database_path": "/var/lib/business-bridge-2-direct/bridge.sqlite3",
        "log_dir": "/var/log/business-bridge-2-direct",
        "service_name": "business-bridge-2-direct.service",
        "service_user": "business-bridge-direct",
        "listen_host": "78.17.68.165",
        "listen_port": 18100,
        "service_version": "0.8.0",
        "identity_metadata_path": "/var/lib/business-bridge-2-direct/identity/identity.json",
        "server_signing_private_key_path": "/etc/business-bridge-2-direct/secrets/server_signing_private_key.pem",
        "openssl_path": "/usr/bin/openssl",
    })

  def test_all_package_modules_import(self) -> None:
    import business_bridge_direct
    names = [module.name for module in pkgutil.iter_modules(business_bridge_direct.__path__, "business_bridge_direct.")]
    self.assertTrue(names)
    for name in names:
        self.assertEqual(importlib.import_module(name).__name__, name)

  def test_import_has_no_side_effects(self) -> None:
    import business_bridge_direct
    calls = {"socket": 0, "popen": 0}
    original_socket = socket.socket
    original_popen = subprocess.Popen

    def socket_probe(*args, **kwargs):
        calls["socket"] += 1
        return original_socket(*args, **kwargs)

    def popen_probe(*args, **kwargs):
        calls["popen"] += 1
        return original_popen(*args, **kwargs)

    socket.socket = socket_probe
    subprocess.Popen = popen_probe
    before = sorted(ROOT.rglob("*") )
    importlib.reload(business_bridge_direct)
    after = sorted(ROOT.rglob("*") )
    socket.socket = original_socket
    subprocess.Popen = original_popen
    self.assertEqual(before, after)
    self.assertEqual(calls, {"socket": 0, "popen": 0})

  def test_source_isolated_and_clean(self) -> None:
    text = "\n".join(path.read_text(encoding="utf-8") for path in PACKAGE.rglob("*.py"))
    self.assertNotIn("/opt/business-bridge-2/", text)
    self.assertNotIn("control_api.token", text)
    self.assertNotIn("import app", text)
    self.assertFalse(any(path.suffix in {".db", ".sqlite3", ".log", ".whl"} for path in ROOT.rglob("*") if path.is_file()))
    self.assertFalse(any(part in {"__pycache__", ".pytest_cache"} for part in (p for p in ROOT.rglob("*") if p.is_dir() for part in p.parts)))
    forbidden = ("TO" + "DO", "TB" + "D", "FIX" + "ME", "HA" + "CK", "X" * 3)
    self.assertFalse(any(token in text for token in forbidden))
    self.assertNotIn("<" * 7, text)
    self.assertNotIn(">" * 7, text)
    self.assertNotIn("=" * 7, text)

  def test_manifest_covers_source_and_is_valid(self) -> None:
    self.assertTrue(MANIFEST.is_file())
    entries = [line.split("  ", 1) for line in MANIFEST.read_text(encoding="utf-8").splitlines() if line.strip()]
    self.assertTrue(entries)
    paths = [relative for _, relative in entries]
    self.assertEqual(paths, sorted(paths))
    self.assertNotIn("./FILE_MANIFEST.sha256", paths)
    self.assertFalse(any(part in {".git", ".venv", "venv", "__pycache__", ".pytest_cache", "build", "dist"} for relative in paths for part in pathlib.PurePosixPath(relative).parts))
    self.assertFalse(any(relative.endswith(('.pyc', '.pyo', '.whl')) or '.egg-info' in relative for relative in paths))
    tracked = subprocess.check_output(["git", "ls-files", "server"], cwd=ROOT, text=True).splitlines()
    expected = sorted("./" + relative.removeprefix("server/") for relative in tracked if relative != "server/FILE_MANIFEST.sha256" and "__pycache__" not in relative and not relative.endswith(('.pyc', '.pyo')))
    self.assertEqual(paths, expected)
    for digest, relative in entries:
        path = SERVER / relative
        self.assertEqual(len(digest), 64)
        self.assertTrue(path.is_file() and not path.is_symlink())
        self.assertEqual(path.stat().st_nlink, 1)
        self.assertNotEqual(path, MANIFEST)
        self.assertEqual(digest, __import__("hashlib").sha256(path.read_bytes()).hexdigest())

  def test_manifest_ignores_generated_files_and_regenerates_identically(self) -> None:
    before = MANIFEST.read_bytes()
    with subprocess.Popen([sys.executable, "-m", "compileall", "-q", str(PACKAGE)], env={**os.environ, "PYTHONPYCACHEPREFIX": "/tmp/bb2-direct-08-pyc"}) as process:
      self.assertEqual(process.wait(), 0)
    self.assertEqual(before, MANIFEST.read_bytes())
    self.assertFalse(any("__pycache__" in relative or relative.endswith((".pyc", ".pyo")) for _, relative in [line.split("  ", 1) for line in MANIFEST.read_text(encoding="utf-8").splitlines()]))

  def test_schema_constant_and_database_contract(self) -> None:
    from business_bridge_direct import database
    self.assertEqual(database.SCHEMA_VERSION, 5)
    with __import__("tempfile").TemporaryDirectory() as directory:
      fresh = pathlib.Path(directory) / "fresh.sqlite3"
      database.initialize_database(str(fresh))
      with sqlite3.connect(fresh) as connection:
        self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
        self.assertEqual(dict(connection.execute("SELECT key,value FROM runtime_metadata")), {"schema_version": "5", "service_version": "0.8.0"})
      self.assertTrue(database.check_database(str(fresh)))
      migrated = pathlib.Path(directory) / "migrated.sqlite3"
      with sqlite3.connect(migrated) as connection:
        connection.execute("CREATE TABLE runtime_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        database._create_pairing_tables(connection)
        connection.execute("CREATE TABLE protocol_sessions(session_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, protocol_version TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, handshake_request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, receive_sequence INTEGER NOT NULL DEFAULT 0, sent_sequence INTEGER NOT NULL DEFAULT 0)")
        connection.execute("CREATE TABLE protocol_replay(session_id TEXT NOT NULL,direction TEXT NOT NULL,request_id TEXT NOT NULL,nonce_hash TEXT NOT NULL,sequence INTEGER NOT NULL,accepted_at TEXT NOT NULL)")
        connection.execute("INSERT INTO runtime_metadata VALUES('schema_version','3')")
        connection.execute("INSERT INTO runtime_metadata VALUES('service_version','0.8.0')")
        connection.execute("PRAGMA user_version=3")
      database.initialize_database(str(migrated))
      with sqlite3.connect(migrated) as connection:
        self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 5)
        self.assertEqual(dict(connection.execute("SELECT key,value FROM runtime_metadata"))["schema_version"], "5")
      self.assertTrue(database.check_database(str(migrated)))
    self.assertNotIn("SCHEMA_VERSION = 3", (PACKAGE / "database.py").read_text(encoding="utf-8"))

  def test_runtime_resources_are_activation_owned(self) -> None:
    # Runtime paths are created by activation, never by source import.
    self.assertFalse(any(path.name in {"service.json", "bridge.sqlite3"} for path in ROOT.rglob("*")))

  def test_venv_isolated_when_running_in_venv(self) -> None:
    if os.environ.get("VIRTUAL_ENV"):
        self.assertNotEqual(sys.prefix, sys.base_prefix)
        self.assertIn(sys.prefix, sys.executable)
        config = pathlib.Path(sys.prefix) / "pyvenv.cfg"
        self.assertIn("include-system-site-packages = false", config.read_text(encoding="utf-8"))
