"""Durable, single-execution task ledger and lease worker primitives."""
from __future__ import annotations
import hashlib, json, secrets, sqlite3, time, uuid
from datetime import datetime, timezone
from .database import _connect, utc_now, TRANSITIONS

APP_VERSION="0.8.0"
STATES={"CREATED","QUEUED","ACCEPTED","RUNNING","SUCCEEDED","FAILED","CANCEL_REQUESTED","CANCELLED","UNKNOWN","EXPIRED"}
TERMINAL={"SUCCEEDED","FAILED","CANCELLED","EXPIRED"}
WORKER_ID=str(uuid.uuid4())

def _uuid4(value: object) -> str:
    if not isinstance(value,str) or value != value.lower(): raise ValueError("invalid_task_request")
    try: u=uuid.UUID(value)
    except (ValueError,AttributeError): raise ValueError("invalid_task_request")
    if u.version != 4 or str(u)!=value: raise ValueError("invalid_task_request")
    return value

def _depth(v: object, level=0):
    if isinstance(v,dict): return max([level]+[_depth(x,level+1) for x in v.values()])
    if isinstance(v,list): return max([level]+[_depth(x,level+1) for x in v])
    return level

def _validate_payload(value: object, limit=2048) -> bytes:
    if not isinstance(value,dict): raise ValueError("invalid_task_request")
    raw=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
    if len(raw)>limit or _depth(value)>8: raise ValueError("invalid_task_request")
    def walk(v):
        if isinstance(v,str) and len(v.encode())>512: raise ValueError("invalid_task_request")
        if isinstance(v,dict):
            if len(v)>64: raise ValueError("invalid_task_request")
            for k,x in v.items():
                if not isinstance(k,str) or len(k.encode())>512: raise ValueError("invalid_task_request")
                walk(x)
        elif isinstance(v,list):
            if len(v)>64: raise ValueError("invalid_task_request")
            for x in v: walk(x)
    walk(value); return raw

def canonical_request(message: dict) -> tuple[str,str]:
    if message.get("type")!="task_create": raise ValueError("invalid_task_request")
    op=_uuid4(message.get("operation_id")); mode=message.get("execution_mode")
    if mode not in {"complete_immediately","remain_pending"}: raise ValueError("invalid_task_request")
    raw=_validate_payload(message.get("task_payload")); canonical=json.dumps({"application_version":APP_VERSION,"task_payload":json.loads(raw),"execution_mode":mode},sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
    return op,hashlib.sha256(canonical).hexdigest()

def _safe(row):
    return dict(zip(("task_id","operation_id","state","task_payload_sha256","execution_count","accepted_at","updated_at","completed_at"),row))

def _transition(c, task_id, old, new, reason, now=None):
    if (old,new) not in TRANSITIONS: raise ValueError("invalid_transition")
    stamp=now or utc_now(); cur=c.execute("UPDATE tasks SET state=?,updated_at=?,completed_at=CASE WHEN ? IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED') THEN COALESCE(completed_at,?) ELSE completed_at END WHERE task_id=? AND state=?",(new,stamp,new,stamp,task_id,old))
    if cur.rowcount != 1: raise ValueError("stale_task_state")
    c.execute("INSERT INTO task_transitions(event_id,task_id,from_state,to_state,occurred_at,reason_code,attempt_number) SELECT ?,?,?,?,?,?,attempt_count FROM tasks WHERE task_id=?",(str(uuid.uuid4()),task_id,old,new,stamp,reason,task_id))

def lookup(path,device_id,ref):
    with _connect(path) as c:
        row=c.execute("SELECT task_id,operation_id,state,task_payload_sha256,execution_count,accepted_at,updated_at,completed_at FROM tasks WHERE device_id=? AND (task_id=? OR operation_id=?)",(device_id,ref,ref)).fetchone()
        if not row: raise ValueError("task_not_found")
        return _safe(row)

def create(path,device_id,message):
    op,digest=canonical_request(message); mode=message["execution_mode"]; payload_digest=hashlib.sha256(_validate_payload(message["task_payload"])).hexdigest(); now=utc_now(); tid=str(uuid.uuid4())
    c=_connect(path)
    try:
        c.execute("BEGIN IMMEDIATE"); old=c.execute("SELECT task_id,canonical_request_sha256 FROM task_operations WHERE device_id=? AND operation_id=?",(device_id,op)).fetchone()
        if old:
            c.rollback()
            if old[1]!=digest: return {},"operation_payload_conflict"
            existing=lookup(path,device_id,old[0])
            if mode=="complete_immediately" and existing["state"] in {"QUEUED","RUNNING"}:
                deadline=time.monotonic()+2.0
                while time.monotonic()<deadline:
                    existing=lookup(path,device_id,old[0])
                    if existing["state"] not in {"QUEUED","RUNNING"}: break
                    time.sleep(0.005)
            return existing,None
        expiry=datetime.fromtimestamp(datetime.fromisoformat(now.replace('Z','+00:00')).timestamp()+600,timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')
        c.execute("INSERT INTO task_operations VALUES(?,?,?,?,?)",(device_id,op,digest,tid,now))
        c.execute("INSERT INTO tasks(task_id,device_id,operation_id,state,task_payload_sha256,execution_mode,attempt_count,execution_count,created_at,accepted_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(tid,device_id,op,"CREATED",payload_digest,mode,0,0,now,now,now,expiry))
        _transition(c,tid,"CREATED","ACCEPTED" if mode=="remain_pending" else "QUEUED","accepted" if mode=="remain_pending" else "queued",now)
        c.commit()
    except Exception: c.rollback(); raise
    finally: c.close()
    if mode=="complete_immediately": process_one(path,tid)
    return lookup(path,device_id,tid),None

def _lease_hash(token): return hashlib.sha256(token.encode()).hexdigest()

def claim(path, worker_id=WORKER_ID, lease_seconds=30, now=None):
    stamp=now or utc_now(); c=_connect(path)
    try:
        c.execute("BEGIN IMMEDIATE"); row=c.execute("SELECT task_id,attempt_count FROM tasks WHERE state='QUEUED' AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at,task_id LIMIT 1",(stamp,)).fetchone()
        if not row: c.rollback(); return None
        token=secrets.token_urlsafe(32); expires=datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()+lease_seconds; exp=datetime.fromtimestamp(expires,timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z'); attempt=row[1]+1
        c.execute("UPDATE tasks SET state='RUNNING',lease_owner=?,lease_token_sha256=?,lease_acquired_at=?,lease_expires_at=?,attempt_count=?,execution_started_at=?,updated_at=? WHERE task_id=? AND state='QUEUED'",(worker_id,_lease_hash(token),stamp,exp,attempt,stamp,stamp,row[0]))
        if c.execute("SELECT changes()").fetchone()[0]!=1: c.rollback(); return None
        c.execute("INSERT INTO task_transitions VALUES(?,?,?,?,?,?,?)",(str(uuid.uuid4()),row[0],"QUEUED","RUNNING",stamp,"claimed",attempt)); c.commit(); return {"task_id":row[0],"worker_id":worker_id,"lease_token":token,"attempt_number":attempt,"lease_expires_at":exp}
    except Exception: c.rollback(); raise
    finally: c.close()

def heartbeat(path,task_id,worker_id,lease_token,now=None,lease_seconds=30):
    stamp=now or utc_now(); exp=datetime.fromtimestamp(datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()+lease_seconds,timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z'); c=_connect(path)
    try:
        c.execute("BEGIN IMMEDIATE"); c.execute("UPDATE tasks SET lease_expires_at=?,updated_at=? WHERE task_id=? AND state='RUNNING' AND lease_owner=? AND lease_token_sha256=? AND lease_expires_at>?",(exp,stamp,task_id,worker_id,_lease_hash(lease_token),stamp)); ok=c.execute("SELECT changes()").fetchone()[0]==1; c.commit(); return ok
    except Exception: c.rollback(); raise
    finally: c.close()

def _report(c,task, state, failure=None):
    if c.execute("SELECT 1 FROM task_reports WHERE task_id=?",(task[0],)).fetchone(): raise ValueError("report_exists")
    data={"report_id":str(uuid.uuid4()),"task_id":task[0],"operation_id":task[1],"state":state,"task_payload_sha256":task[2],"execution_count":1}
    if failure: data["failure_code"]=failure
    encoded=json.dumps(data,sort_keys=True,separators=(",",":"),ensure_ascii=False); c.execute("INSERT INTO task_reports VALUES(?,?,?,?,?,?)",(data["report_id"],task[0],task[3],hashlib.sha256(encoded.encode()).hexdigest(),encoded,utc_now())); return data

def complete(path,task_id,worker_id,lease_token,attempt_number,success=True,safe_failure_code="execution_failed",now=None):
    stamp=now or utc_now(); c=_connect(path)
    try:
        c.execute("BEGIN IMMEDIATE"); task=c.execute("SELECT task_id,operation_id,task_payload_sha256,device_id,state,execution_count,attempt_count,lease_expires_at FROM tasks WHERE task_id=?",(task_id,)).fetchone()
        if not task or task[4]!="RUNNING" or task[5]!=0 or task[6]!=attempt_number or task[7]<=stamp if task else True: c.rollback(); raise ValueError("stale_lease")
        check=c.execute("SELECT 1 FROM tasks WHERE task_id=? AND lease_owner=? AND lease_token_sha256=?",(task_id,worker_id,_lease_hash(lease_token))).fetchone()
        if not check: c.rollback(); raise ValueError("stale_lease")
        state="SUCCEEDED" if success else "FAILED"; report=_report(c,task,state,None if success else safe_failure_code)
        c.execute("UPDATE tasks SET state=?,execution_count=1,completed_at=?,updated_at=?,lease_owner=NULL,lease_token_sha256=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,failure_code=? WHERE task_id=? AND state='RUNNING'",(state,stamp,stamp,None if success else safe_failure_code,task_id)); c.execute("INSERT INTO task_transitions VALUES(?,?,?,?,?,?,?)",(str(uuid.uuid4()),task_id,"RUNNING",state,stamp,"completed" if success else "failed",attempt_number)); c.commit(); return report
    except Exception:
        try: c.rollback()
        except Exception: pass
        raise
    finally: c.close()

def process_one(path,task_id=None):
    lease=claim(path)
    if not lease: return None
    return complete(path,lease["task_id"],lease["worker_id"],lease["lease_token"],lease["attempt_number"])

def recover(path,now=None):
    stamp=now or utc_now(); c=_connect(path); counts={}
    try:
        c.execute("BEGIN IMMEDIATE")
        for tid,state,exp,started in c.execute("SELECT task_id,state,expires_at,execution_started_at FROM tasks WHERE state IN ('CREATED','QUEUED','ACCEPTED','RUNNING','CANCEL_REQUESTED')").fetchall():
            new=None; reason="recovery"
            if exp and exp<=stamp and state in {"CREATED","QUEUED","ACCEPTED"}: new="EXPIRED"; reason="expired"
            elif state=="CREATED": new="QUEUED"; reason="requeue_created"
            elif state=="RUNNING": new="UNKNOWN"; reason="restart_ambiguity"
            elif state=="CANCEL_REQUESTED": new="UNKNOWN" if started else "CANCELLED"; reason="possible_side_effect" if started else "cancel_before_execution"
            if new: _transition(c,tid,state,new,reason,stamp); c.execute("UPDATE tasks SET lease_owner=NULL,lease_token_sha256=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,recovery_reason=? WHERE task_id=?",(reason,tid)); counts[new]=counts.get(new,0)+1
        c.commit(); return counts
    except Exception: c.rollback(); raise
    finally: c.close()

def cancel(path,device_id,ref):
    c=_connect(path)
    try:
        c.execute("BEGIN IMMEDIATE"); row=c.execute("SELECT task_id,operation_id,state,task_payload_sha256,execution_count,accepted_at,updated_at,completed_at,execution_started_at FROM tasks WHERE device_id=? AND (task_id=? OR operation_id=?)",(device_id,ref,ref)).fetchone()
        if not row: c.rollback(); return {},"task_not_found"
        state=row[2]
        if state in {"SUCCEEDED","FAILED","UNKNOWN","EXPIRED"}: c.rollback(); return {},"not_cancellable"
        if state=="CANCELLED": c.rollback(); return _safe(row[:8]),None
        if state=="CANCEL_REQUESTED": c.rollback(); return _safe(row[:8]),None
        new="CANCEL_REQUESTED" if state=="RUNNING" else "CANCELLED"; _transition(c,row[0],state,new,"cancel_requested" if new=="CANCEL_REQUESTED" else "cancelled"); c.commit(); return lookup(path,device_id,row[0]),None
    except Exception: c.rollback(); raise
    finally: c.close()

def report(path,device_id,ref):
    with _connect(path) as c:
        row=c.execute("SELECT task_id FROM tasks WHERE device_id=? AND (task_id=? OR operation_id=?)",(device_id,ref,ref)).fetchone()
        if not row: return {},"task_not_found"
        out=c.execute("SELECT report_id,content_hash,report_json FROM task_reports WHERE task_id=? AND device_id=?",(row[0],device_id)).fetchone()
        if not out: return {},"report_not_available"
        value=json.loads(out[2]); value["content_hash"]=out[1]; return value,None

def reconcile(path,device_id,task_id,outcome,proof=False,safe_failure_code="reconciled_failure"):
    if outcome not in {"SUCCEEDED","FAILED","CANCELLED"} or not proof: return lookup(path,device_id,task_id),"proof_required" if not proof else "invalid_reconciliation"
    c=_connect(path)
    try:
        c.execute("BEGIN IMMEDIATE"); task=c.execute("SELECT task_id,operation_id,state,task_payload_sha256,device_id FROM tasks WHERE task_id=? AND device_id=?",(task_id,device_id)).fetchone()
        if not task: c.rollback(); return {},"task_not_found"
        if task[2]!="UNKNOWN": c.rollback(); return {},"invalid_reconciliation"
        if outcome=="CANCELLED": _transition(c,task_id,"UNKNOWN","CANCELLED","reconciled_no_side_effect")
        else:
            _report(c,(task[0],task[1],task[3],task[4]),outcome,None if outcome=="SUCCEEDED" else safe_failure_code); _transition(c,task_id,"UNKNOWN",outcome,"reconciled")
            c.execute("UPDATE tasks SET execution_count=1,failure_code=? WHERE task_id=?",(None if outcome=="SUCCEEDED" else safe_failure_code,task_id))
        c.commit(); return lookup(path,device_id,task_id),None
    except Exception: c.rollback(); raise
    finally: c.close()
