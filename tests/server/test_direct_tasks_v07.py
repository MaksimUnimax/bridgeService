from __future__ import annotations
import sqlite3, tempfile, uuid
from pathlib import Path
import unittest
from business_bridge_direct.database import initialize_database
from business_bridge_direct import tasks
from business_bridge_direct.deployment import prepare_staging

OWNER = "00000000-0000-4000-8000-000000000002"
SESSION = "00000000-0000-4000-8000-000000000001"

class DirectTaskV07Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.db = str(Path(self.tmp.name)/"direct.sqlite3"); initialize_database(self.db)
        with sqlite3.connect(self.db) as c:
            c.execute("insert into pairing_sessions values(?,?,?,?,?,?,?,?,?,?,?)", (SESSION,b"s",b"v","2026-01-01Z","2030-01-01Z",0,5,"CONSUMED","2026-01-01Z",OWNER,None))
            c.execute("insert into paired_devices values(?,?,?,?,?,?,?)", (OWNER,"pub","fp","2026-01-01Z","ACTIVE",None,SESSION))
    def tearDown(self): self.tmp.cleanup()
    def message(self, op=None, payload=None, mode="complete_immediately"):
        return {"type":"task_create", "operation_id":op or str(uuid.uuid4()), "task_payload":payload or {"b":1,"a":["safe"]}, "execution_mode":mode}
    def test_equivalent_canonical_idempotency_and_conflict(self):
        q=self.message(); first,error=tasks.create(self.db,OWNER,q); self.assertIsNone(error)
        equivalent={**q,"task_payload":{"a":["safe"],"b":1}}; second,error=tasks.create(self.db,OWNER,equivalent)
        self.assertIsNone(error); self.assertEqual(first["task_id"],second["task_id"]); self.assertEqual(second["execution_count"],1)
        conflict={**q,"task_payload":{"different":True}}; _,error=tasks.create(self.db,OWNER,conflict); self.assertEqual(error,"operation_payload_conflict")
        with sqlite3.connect(self.db) as c: self.assertEqual(c.execute("select count(*) from tasks").fetchone()[0],1)
    def test_pending_cancel_repeated_and_report(self):
        first,error=tasks.create(self.db,OWNER,self.message(mode="remain_pending")); self.assertIsNone(error); self.assertEqual(first["state"],"ACCEPTED")
        self.assertEqual(tasks.report(self.db,OWNER,first["task_id"])[1],"report_not_available")
        cancelled,error=tasks.cancel(self.db,OWNER,first["task_id"]); self.assertIsNone(error); self.assertEqual(cancelled["state"],"CANCELLED")
        repeated,error=tasks.cancel(self.db,OWNER,first["task_id"]); self.assertIsNone(error); self.assertEqual(repeated["state"],"CANCELLED")
        self.assertEqual(tasks.report(self.db,OWNER,first["task_id"])[1],"report_not_available")
    def test_report_is_immutable_and_foreign_denied(self):
        first,_=tasks.create(self.db,OWNER,self.message()); report,error=tasks.report(self.db,OWNER,first["task_id"]); again,error2=tasks.report(self.db,OWNER,first["task_id"])
        self.assertIsNone(error); self.assertIsNone(error2); self.assertEqual(report,again)
        with self.assertRaisesRegex(ValueError,"task_not_found"): tasks.lookup(self.db,"00000000-0000-4000-8000-000000000003",first["task_id"])
    def test_schema_foreign_keys_and_failed_migration_rollback(self):
        with sqlite3.connect(self.db) as c:
            self.assertEqual(c.execute("pragma user_version").fetchone()[0],4); self.assertEqual(c.execute("pragma integrity_check").fetchone()[0],"ok"); self.assertEqual(c.execute("pragma foreign_key_check").fetchall(),[])
        p=Path(self.tmp.name)/"v3.sqlite3"
        with sqlite3.connect(p) as c:
            c.execute("create table runtime_metadata(key text primary key,value text not null)"); c.execute("insert into runtime_metadata values('schema_version','3')"); c.execute("insert into runtime_metadata values('service_version','0.6.0')"); c.execute("create table task_operations(bad text)"); c.execute("pragma user_version=3")
        from business_bridge_direct.database import _migrate
        with sqlite3.connect(p) as c:
            c.execute("pragma foreign_keys=on")
            from business_bridge_direct.database import _migrate
            with self.assertRaises(sqlite3.OperationalError):
                _migrate(c)
        with sqlite3.connect(p) as c: self.assertEqual(c.execute("pragma user_version").fetchone()[0],3)
    def test_scratch_symlink_and_hardlink_boundaries(self):
        root=Path(self.tmp.name)/"stage"; (root/"venv/bin").mkdir(parents=True); (root/"app.py").write_text("x"); external=Path(self.tmp.name)/"external"; external.write_text("interpreter"); external.chmod(0o755); (root/"venv/bin/python").symlink_to(external)
        before=(external.stat().st_mode,external.read_bytes()); prepare_staging(str(root), directories=("venv", "venv/bin"), files=("app.py",)); self.assertEqual(before,(external.stat().st_mode,external.read_bytes()))
        with self.assertRaises(ValueError): prepare_staging(str(root), files=("venv/bin/python",))
        (root/"hard").hardlink_to(root/"app.py")
        with self.assertRaises(ValueError): prepare_staging(str(root), files=("hard",))
