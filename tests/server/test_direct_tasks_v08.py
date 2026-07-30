from __future__ import annotations
import concurrent.futures, sqlite3, tempfile, threading, uuid, unittest
from pathlib import Path
from business_bridge_direct.database import initialize_database
from business_bridge_direct import tasks
from business_bridge_direct.tasks import recover

DEVICE="00000000-0000-4000-8000-000000000001"
SESSION="00000000-0000-4000-8000-000000000002"

class DurableTaskTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.db=str(Path(self.tmp.name)/"db.sqlite3"); initialize_database(self.db)
        with sqlite3.connect(self.db) as c:
            c.execute("insert into pairing_sessions values(?,?,?,?,?,?,?,?,?,?,?)",(SESSION,b"s",b"v","2026-01-01Z","2030-01-01Z",0,5,"CONSUMED","2026-01-01Z",DEVICE,None))
            c.execute("insert into paired_devices values(?,?,?,?,?,?,?)",(DEVICE,"pub","fp","2026-01-01Z","ACTIVE",None,SESSION))
    def tearDown(self): self.tmp.cleanup()
    def msg(self, mode="complete_immediately", op=None): return {"type":"task_create","operation_id":op or str(uuid.uuid4()),"task_payload":{"safe":True},"execution_mode":mode}
    def test_states_transitions_recovery_and_reconciliation(self):
        first,_=tasks.create(self.db,DEVICE,self.msg("remain_pending")); self.assertEqual(first["state"],"ACCEPTED")
        self.assertEqual(tasks.cancel(self.db,DEVICE,first["task_id"])[0]["state"],"CANCELLED")
        op=str(uuid.uuid4()); queued,_=tasks.create(self.db,DEVICE,self.msg("complete_immediately",op)); self.assertEqual(queued["state"],"SUCCEEDED")
        unknown_tid=str(uuid.uuid4()); now="2026-01-01T00:00:00Z"
        with sqlite3.connect(self.db) as c:
            c.execute("insert into task_operations values(?,?,?,?,?)",(DEVICE,op+"1","h",unknown_tid,now)); c.execute("insert into tasks(task_id,device_id,operation_id,state,task_payload_sha256,execution_mode,attempt_count,execution_count,created_at,accepted_at,updated_at,expires_at) values(?,?,?,?,?,?,?,?,?,?,?,?)",(unknown_tid,DEVICE,op+"1","RUNNING","h","complete_immediately",1,0,now,now,now,"2030-01-01Z"))
        recover(self.db,now); self.assertEqual(tasks.lookup(self.db,DEVICE,unknown_tid)["state"],"UNKNOWN"); self.assertEqual(recover(self.db,now),{})
        result,error=tasks.reconcile(self.db,DEVICE,unknown_tid,"FAILED",proof=True); self.assertIsNone(error); self.assertEqual(result["state"],"FAILED"); self.assertEqual(tasks.reconcile(self.db,DEVICE,unknown_tid,"FAILED",proof=True)[1],"invalid_reconciliation")
    def test_concurrent_duplicate_single_task_and_execution(self):
        message=self.msg();
        def make(_): return tasks.create(self.db,DEVICE,message)[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool: values=list(pool.map(make,range(20)))
        self.assertEqual(len({x["task_id"] for x in values}),1); self.assertEqual(values[0]["execution_count"],1)
        with sqlite3.connect(self.db) as c:
            self.assertEqual(c.execute("select count(*) from tasks").fetchone()[0],1); self.assertEqual(c.execute("select count(*) from task_reports").fetchone()[0],1); self.assertEqual(c.execute("select count(*) from task_transitions where to_state='RUNNING'").fetchone()[0],1)
    def test_lease_race_stale_owner_and_hash_only(self):
        task,_=tasks.create(self.db,DEVICE,self.msg("remain_pending"));
        with sqlite3.connect(self.db) as c: c.execute("update tasks set state='QUEUED' where task_id=?",(task["task_id"],))
        def claim(i): return tasks.claim(self.db,str(uuid.uuid4()),now="2026-01-01T00:00:00Z")
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool: winners=[x for x in pool.map(claim,range(20)) if x]
        self.assertEqual(len(winners),1); lease=winners[0]
        with sqlite3.connect(self.db) as c:
            stored=c.execute("select lease_token_sha256 from tasks where task_id=?",(task["task_id"],)).fetchone()[0]; self.assertEqual(len(stored),64); self.assertNotEqual(stored,lease["lease_token"])
        with self.assertRaisesRegex(ValueError,"stale_lease"): tasks.complete(self.db,task["task_id"],str(uuid.uuid4()),lease["lease_token"],lease["attempt_number"],now="2026-01-01T00:00:01Z")
        tasks.complete(self.db,task["task_id"],lease["worker_id"],lease["lease_token"],lease["attempt_number"],now="2026-01-01T00:00:01Z")
        self.assertEqual(tasks.lookup(self.db,DEVICE,task["task_id"])["state"],"SUCCEEDED")

if __name__=="__main__": unittest.main()
