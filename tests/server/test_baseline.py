from __future__ import annotations

import importlib
import os
import pathlib
import pkgutil
import socket
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
        "listen_host": "127.0.0.1",
        "listen_port": 18100,
        "service_version": "0.2.0",
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
    for digest, relative in entries:
        path = SERVER / relative
        self.assertEqual(len(digest), 64)
        self.assertTrue(path.is_file())
        self.assertNotEqual(path, MANIFEST)
        self.assertEqual(digest, __import__("hashlib").sha256(path.read_bytes()).hexdigest())

  def test_runtime_resources_are_not_present(self) -> None:
    install_path = pathlib.Path("/opt/business-bridge-2-direct")
    if ROOT == install_path:
        self.assertTrue(install_path.is_dir())
        self.assertTrue((install_path / ".venv").is_dir())
    # Runtime paths are created by the activation run, never by source import.
    self.assertFalse(any(path.name in {"service.json", "bridge.sqlite3"} for path in ROOT.rglob("*")))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        self.assertNotEqual(probe.connect_ex(("127.0.0.1", 18100)), 0)

  def test_venv_isolated_when_running_in_venv(self) -> None:
    if os.environ.get("VIRTUAL_ENV"):
        self.assertNotEqual(sys.prefix, sys.base_prefix)
        self.assertIn(sys.prefix, sys.executable)
        config = pathlib.Path(sys.prefix) / "pyvenv.cfg"
        self.assertIn("include-system-site-packages = false", config.read_text(encoding="utf-8"))
