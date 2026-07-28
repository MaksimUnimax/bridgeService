from __future__ import annotations

import os
import pathlib
import stat
import tempfile
import unittest


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
