from __future__ import annotations

import hashlib
import importlib
import os
import pathlib
import subprocess
import sys
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"
REQUIRED = {
    "business_bridge_direct/__init__.py",
    "business_bridge_direct/config.py",
    "business_bridge_direct/database.py",
    "business_bridge_direct/defaults.py",
    "business_bridge_direct/deployment.py",
    "business_bridge_direct/http_api.py",
    "business_bridge_direct/identity.py",
    "business_bridge_direct/identity_cli.py",
    "business_bridge_direct/main.py",
    "business_bridge_direct/pairing.py",
    "business_bridge_direct/pairing_cli.py",
    "business_bridge_direct/protocol.py",
    "business_bridge_direct/protocol_crypto.py",
    "business_bridge_direct/py.typed",
}


class WheelCompletenessTests(unittest.TestCase):
    def test_clean_wheel_contains_complete_runtime_package(self) -> None:
        wheel = pathlib.Path(os.environ["BB2_WHEEL_UNDER_TEST"])
        self.assertTrue(wheel.is_file())
        self.assertEqual(wheel.name, "business_bridge_2_direct-0.7.0-py3-none-any.whl")
        with zipfile.ZipFile(wheel) as archive:
            self.assertEqual(archive.testzip(), None)
            names = set(archive.namelist())
            self.assertTrue(REQUIRED <= names)
            self.assertTrue(all(sum(name == required for name in names) == 1 for required in REQUIRED))
            self.assertFalse(any(name.endswith(('.pyc', '.pyo')) or '__pycache__' in name or '/build/' in name or name.startswith('build/') or name.startswith('server/') for name in names))
            self.assertFalse(any("build/lib" in name or name.endswith(".egg-info/SOURCES.txt") for name in names))
            record = next(name for name in names if name.endswith(".dist-info/RECORD"))
            record_lines = archive.read(record).decode().splitlines()
            self.assertTrue(any(line.startswith("business_bridge_direct/identity_cli.py,") for line in record_lines))
            for line in record_lines:
                name, digest, size = line.rsplit(",", 2)
                if name == record:
                    continue
                data = archive.read(name)
                self.assertEqual(size, str(len(data)))
                expected = __import__("base64").urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
                self.assertEqual(digest, "sha256=" + expected)

    def test_installed_wheel_imports_runtime_modules_and_contract(self) -> None:
        wheel = pathlib.Path(os.environ["BB2_WHEEL_UNDER_TEST"])
        with __import__("tempfile").TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--no-deps", "--target", directory, str(wheel)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            probe = subprocess.run([sys.executable, "-c", "import sys;sys.path.insert(0,sys.argv[1]);import business_bridge_direct, business_bridge_direct.database as d, business_bridge_direct.tasks, business_bridge_direct.deployment, business_bridge_direct.protocol;assert business_bridge_direct.__version__=='0.7.0';assert d.SCHEMA_VERSION==4", directory], capture_output=True, text=True)
            self.assertEqual(probe.returncode, 0, probe.stderr)
