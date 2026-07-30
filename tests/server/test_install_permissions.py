from __future__ import annotations

import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest

from business_bridge_direct.deployment import normalize_staging_runtime


class InstallPermissionPolicyTests(unittest.TestCase):
  def test_source_install_policy_has_no_unprivileged_write_bits(self) -> None:
    source = pathlib.Path(__file__).parents[2] / "server/src/business_bridge_direct"
    self.assertTrue(source.is_dir())
    for path in source.rglob("*"):
      if path.is_dir():
        self.assertEqual(stat.S_IMODE(path.stat().st_mode) & 0o022, 0)
      elif path.is_file() and path.suffix == ".py":
        self.assertEqual(stat.S_IMODE(path.stat().st_mode) & 0o022, 0)

  def test_identity_boundary_is_not_service_writable_or_world_readable(self) -> None:
    with tempfile.TemporaryDirectory() as directory:
      root = pathlib.Path(directory)
      identity = root / "identity"
      identity.mkdir()
      metadata = identity / "identity.json"
      metadata.write_text("{}", encoding="utf-8")
      os.chmod(identity, 0o750)
      os.chmod(metadata, 0o640)
      self.assertEqual(stat.S_IMODE(identity.stat().st_mode), 0o750)
      self.assertEqual(stat.S_IMODE(metadata.stat().st_mode), 0o640)
      self.assertFalse(stat.S_IMODE(identity.stat().st_mode) & 0o002)
      self.assertFalse(stat.S_IMODE(metadata.stat().st_mode) & 0o004)

  def test_private_identity_material_is_not_printed_or_hashed(self) -> None:
    source = pathlib.Path(__file__).parents[2] / "server/src/business_bridge_direct/identity.py"
    text = source.read_text(encoding="utf-8")
    self.assertNotIn("print(key", text)
    self.assertNotIn("hashlib.sha256(key", text)

  @unittest.skipUnless(os.geteuid() == 0, "requires root to reproduce ownership boundary")
  def test_complete_tree_normalizes_root_only_runtime_for_service_user(self) -> None:
    import grp
    import pwd

    gid = grp.getgrnam("business-bridge-direct").gr_gid
    uid = pwd.getpwnam("business-bridge-direct").pw_uid
    with tempfile.TemporaryDirectory() as directory:
      root = pathlib.Path(directory) / "stage"
      os.chown(directory, 0, gid)
      os.chmod(directory, 0o750)
      runtime = root / "runtime"
      package = runtime / ".venv/lib/python3.10/site-packages/business_bridge_direct"
      bin_dir = runtime / ".venv/bin"
      package.mkdir(parents=True)
      bin_dir.mkdir(parents=True)
      (package / "__init__.py").write_text("VALUE = 1\n", encoding="utf-8")
      (package / "nested.py").write_text("VALUE = 2\n", encoding="utf-8")
      (runtime / ".venv/lib/python3.10/site-packages/dep.py").write_text("VALUE = 3\n", encoding="utf-8")
      interpreter = pathlib.Path(sys.executable)
      (bin_dir / "python").symlink_to(interpreter)
      for path in sorted(runtime.rglob("*")):
        if path.is_dir(): os.chmod(path, 0o700)
        elif not path.is_symlink(): os.chmod(path, 0o600)
      os.chmod(root, 0o700)
      before = (interpreter.stat().st_mode, interpreter.stat().st_uid, interpreter.stat().st_gid)
      inventory = normalize_staging_runtime(root, uid, gid, ("runtime",))
      self.assertGreaterEqual(len(inventory), 8)
      probe = subprocess.run(
          [sys.executable, "-c", "import pathlib; import business_bridge_direct; print(business_bridge_direct.VALUE)"],
          env={"PYTHONPATH": str(package.parent)}, capture_output=True, text=True,
          preexec_fn=lambda: (os.setgid(gid), os.setuid(uid)), check=False)
      self.assertEqual(probe.returncode, 0, probe.stderr)
      self.assertEqual(probe.stdout.strip(), "1")
      self.assertEqual(before, (interpreter.stat().st_mode, interpreter.stat().st_uid, interpreter.stat().st_gid))
      for item in inventory:
        self.assertNotIn("0o2", item["mode"])

  @unittest.skipUnless(os.geteuid() == 0, "requires root to reproduce ownership boundary")
  def test_symlink_hardlink_and_unsafe_type_fail_closed_before_mutation(self) -> None:
    import grp
    import pwd

    gid = grp.getgrnam("business-bridge-direct").gr_gid
    uid = pwd.getpwnam("business-bridge-direct").pw_uid
    with tempfile.TemporaryDirectory() as directory:
      root = pathlib.Path(directory) / "stage"
      runtime = root / "runtime"
      runtime.mkdir(parents=True)
      safe = runtime / "safe.py"
      safe.write_text("x", encoding="utf-8")
      os.chmod(root, 0o700); os.chmod(runtime, 0o700); os.chmod(safe, 0o600)
      outside = pathlib.Path(directory) / "outside"
      outside.write_text("do not touch", encoding="utf-8")
      (runtime / "escape").symlink_to(outside)
      with self.assertRaises(ValueError): normalize_staging_runtime(root, uid, gid, ("runtime",))
      self.assertEqual(stat.S_IMODE(safe.stat().st_mode), 0o600)
      self.assertEqual(outside.read_text(encoding="utf-8"), "do not touch")
      (runtime / "escape").unlink()
      os.mkfifo(runtime / "pipe")
      with self.assertRaises(ValueError): normalize_staging_runtime(root, uid, gid, ("runtime",))
      (runtime / "pipe").unlink()
      hard = runtime / "hard"
      hard.hardlink_to(safe)
      with self.assertRaises(ValueError): normalize_staging_runtime(root, uid, gid, ("runtime",))
      self.assertEqual(stat.S_IMODE(safe.stat().st_mode), 0o600)
