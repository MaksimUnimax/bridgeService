"""SQLite storage, atomic schema migration, and durable job recovery."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

from . import __version__

SCHEMA_VERSION = 5
SERVICE_VERSION = __version__
MAX_ATTEMPTS = 5
DEFAULT_TTL_SECONDS = 600
STATES = {"CREATED", "QUEUED", "ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "CANCEL_REQUESTED", "CANCELLED", "UNKNOWN", "EXPIRED"}
TRANSITIONS = {
    ("CREATED", "QUEUED"), ("CREATED", "ACCEPTED"), ("QUEUED", "RUNNING"),
    ("RUNNING", "SUCCEEDED"), ("RUNNING", "FAILED"), ("CREATED", "CANCELLED"),
    ("QUEUED", "CANCELLED"), ("ACCEPTED", "CANCELLED"), ("RUNNING", "CANCEL_REQUESTED"),
    ("CANCEL_REQUESTED", "CANCELLED"), ("CREATED", "EXPIRED"), ("QUEUED", "EXPIRED"),
    ("ACCEPTED", "EXPIRED"), ("RUNNING", "UNKNOWN"), ("CANCEL_REQUESTED", "UNKNOWN"),
    ("UNKNOWN", "SUCCEEDED"), ("UNKNOWN", "FAILED"), ("UNKNOWN", "CANCELLED"),
}
# Tests may set this to a symbolic checkpoint; production never sets it.
MIGRATION_FAILPOINT: str | None = None

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def _uuid4(value: str | None = None) -> str:
    value = value or str(uuid.uuid4())
    if str(uuid.UUID(value)) != value.lower() or uuid.UUID(value).version != 4 or value != value.lower(): raise ValueError("invalid uuid")
    return value

def _connect(path: str) -> sqlite3.Connection:
    db = Path(path)
    if db.is_symlink() or (db.exists() and not db.is_file()): raise ValueError("invalid database file")
    db.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(db, timeout=2.0, isolation_level=None)
    c.execute("PRAGMA foreign_keys=ON")
    return c

def _create_pairing_tables(c: sqlite3.Connection) -> None:
    for sql in ("""
      CREATE TABLE IF NOT EXISTS pairing_sessions(session_id TEXT PRIMARY KEY CHECK(length(session_id)=36), code_salt BLOB NOT NULL, code_verifier BLOB NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0), max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 5), status TEXT NOT NULL CHECK(status IN ('ACTIVE','CONSUMED','EXPIRED','LOCKED','REVOKED')), consumed_at TEXT, paired_device_id TEXT, revoked_at TEXT)
    """, """
      CREATE TABLE IF NOT EXISTS paired_devices(device_id TEXT PRIMARY KEY CHECK(length(device_id)=36), public_key_spki TEXT NOT NULL, device_fingerprint TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED')), revoked_at TEXT, pairing_session_id TEXT NOT NULL UNIQUE, FOREIGN KEY(pairing_session_id) REFERENCES pairing_sessions(session_id))
    """, """
      CREATE TABLE IF NOT EXISTS pairing_audit_events(audit_event_id TEXT PRIMARY KEY,event_time TEXT NOT NULL,event_type TEXT NOT NULL,result_class TEXT NOT NULL,session_id TEXT,device_id TEXT,reason_code TEXT)
    """): c.execute(sql)

def _create_protocol_tables(c: sqlite3.Connection) -> None:
    c.execute("""CREATE TABLE IF NOT EXISTS protocol_sessions(session_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,protocol_version TEXT NOT NULL CHECK(protocol_version='BB2D-P1'),created_at TEXT NOT NULL,expires_at TEXT NOT NULL,handshake_request_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('ACTIVE','EXPIRED','REKEY_REQUIRED','CLOSED')),receive_sequence INTEGER NOT NULL DEFAULT 0 CHECK(receive_sequence>=0),sent_sequence INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(device_id) REFERENCES paired_devices(device_id))""")
    c.execute("""CREATE TABLE IF NOT EXISTS protocol_replay(session_id TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN ('c2s','s2c')),request_id TEXT NOT NULL,nonce_hash TEXT NOT NULL,sequence INTEGER NOT NULL,accepted_at TEXT NOT NULL,PRIMARY KEY(session_id,direction,request_id),UNIQUE(session_id,direction,nonce_hash),UNIQUE(session_id,direction,sequence),FOREIGN KEY(session_id) REFERENCES protocol_sessions(session_id))""")

def _create_v4_tasks(c: sqlite3.Connection) -> None:
    c.execute("CREATE TABLE IF NOT EXISTS task_operations(device_id TEXT NOT NULL REFERENCES paired_devices(device_id),operation_id TEXT NOT NULL,canonical_request_sha256 TEXT NOT NULL,task_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,PRIMARY KEY(device_id,operation_id))")
    c.execute("CREATE TABLE IF NOT EXISTS tasks(task_id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES paired_devices(device_id),operation_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('ACCEPTED','SUCCEEDED','CANCELLED')),task_payload_sha256 TEXT NOT NULL,execution_mode TEXT NOT NULL CHECK(execution_mode IN ('complete_immediately','remain_pending')),execution_count INTEGER NOT NULL CHECK(execution_count IN (0,1)),accepted_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,UNIQUE(device_id,operation_id),FOREIGN KEY(device_id,operation_id) REFERENCES task_operations(device_id,operation_id))")
    c.execute("CREATE TABLE IF NOT EXISTS task_reports(report_id TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id),device_id TEXT NOT NULL REFERENCES paired_devices(device_id),content_hash TEXT NOT NULL,report_json TEXT NOT NULL,created_at TEXT NOT NULL)")

def _create_v5_tasks(c: sqlite3.Connection) -> None:
    c.execute("CREATE TABLE task_operations_new(device_id TEXT NOT NULL REFERENCES paired_devices(device_id),operation_id TEXT NOT NULL,canonical_request_sha256 TEXT NOT NULL,task_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,PRIMARY KEY(device_id,operation_id))")
    c.execute("""CREATE TABLE tasks_new(
      task_id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES paired_devices(device_id), operation_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('CREATED','QUEUED','ACCEPTED','RUNNING','SUCCEEDED','FAILED','CANCEL_REQUESTED','CANCELLED','UNKNOWN','EXPIRED')),
      task_payload_sha256 TEXT NOT NULL, execution_mode TEXT NOT NULL CHECK(execution_mode IN ('complete_immediately','remain_pending')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0), execution_count INTEGER NOT NULL CHECK(execution_count IN (0,1)),
      created_at TEXT NOT NULL, accepted_at TEXT, updated_at TEXT NOT NULL, completed_at TEXT, expires_at TEXT,
      lease_owner TEXT, lease_token_sha256 TEXT, lease_acquired_at TEXT, lease_expires_at TEXT, execution_started_at TEXT,
      cancellation_requested_at TEXT, failure_code TEXT, recovery_reason TEXT,
      UNIQUE(device_id,operation_id), FOREIGN KEY(device_id,operation_id) REFERENCES task_operations_new(device_id,operation_id))""")
    c.execute("CREATE TABLE task_reports_new(report_id TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE REFERENCES tasks_new(task_id),device_id TEXT NOT NULL REFERENCES paired_devices(device_id),content_hash TEXT NOT NULL,report_json TEXT NOT NULL,created_at TEXT NOT NULL)")
    c.execute("CREATE TABLE task_transitions(event_id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks_new(task_id),from_state TEXT,to_state TEXT NOT NULL,occurred_at TEXT NOT NULL,reason_code TEXT NOT NULL,attempt_number INTEGER NOT NULL DEFAULT 0)")
    c.execute("CREATE INDEX tasks_device_state ON tasks_new(device_id,state,updated_at)")
    c.execute("CREATE INDEX tasks_lease_expiry ON tasks_new(state,lease_expires_at)")
    c.execute("CREATE INDEX task_transitions_task ON task_transitions(task_id,occurred_at)")
    c.execute("CREATE INDEX task_reports_device ON task_reports_new(device_id,task_id)")

def _upgrade_tasks_4_to_5(c: sqlite3.Connection) -> None:
    _create_v5_tasks(c)
    c.execute("INSERT INTO task_operations_new SELECT device_id,operation_id,canonical_request_sha256,task_id,created_at FROM task_operations")
    c.execute("""INSERT INTO tasks_new(task_id,device_id,operation_id,state,task_payload_sha256,execution_mode,attempt_count,execution_count,created_at,accepted_at,updated_at,completed_at)
      SELECT task_id,device_id,operation_id,state,task_payload_sha256,execution_mode,0,execution_count,accepted_at,accepted_at,updated_at,completed_at FROM tasks""")
    c.execute("INSERT INTO task_reports_new SELECT report_id,task_id,device_id,content_hash,report_json,created_at FROM task_reports")
    c.execute("INSERT INTO task_transitions(event_id,task_id,from_state,to_state,occurred_at,reason_code,attempt_number) SELECT lower(hex(randomblob(16))),task_id,NULL,state,accepted_at,'migrated_v4',execution_count FROM tasks")
    c.execute("DROP TABLE task_reports"); c.execute("DROP TABLE tasks"); c.execute("DROP TABLE task_operations")
    c.execute("ALTER TABLE task_operations_new RENAME TO task_operations"); c.execute("ALTER TABLE tasks_new RENAME TO tasks"); c.execute("ALTER TABLE task_reports_new RENAME TO task_reports")
    if MIGRATION_FAILPOINT == "after_tasks": raise sqlite3.OperationalError("injected migration failure")

def _migrate(c: sqlite3.Connection) -> None:
    c.execute("BEGIN IMMEDIATE")
    try:
        v=int(c.execute("PRAGMA user_version").fetchone()[0])
        if v==0:
            c.execute("CREATE TABLE IF NOT EXISTS runtime_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)"); c.execute("PRAGMA user_version=1"); v=1
        if v==1: _create_pairing_tables(c); c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('schema_version','2')"); c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('service_version',?)", (SERVICE_VERSION,)); c.execute("PRAGMA user_version=2"); v=2
        if v==2: _create_protocol_tables(c); c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('schema_version','3')"); c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('service_version',?)", (SERVICE_VERSION,)); c.execute("PRAGMA user_version=3"); v=3
        if v==3: _create_v4_tasks(c); c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('schema_version','4')"); c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('service_version',?)", (SERVICE_VERSION,)); c.execute("PRAGMA user_version=4"); v=4
        if v==4: _upgrade_tasks_4_to_5(c); v=5
        if v!=5: raise ValueError("unsupported schema")
        _create_pairing_tables(c); _create_protocol_tables(c)
        c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('schema_version','5')"); c.execute("INSERT OR REPLACE INTO runtime_metadata VALUES('service_version',?)", (SERVICE_VERSION,)); c.execute("PRAGMA user_version=5")
        c.commit()
    except Exception:
        c.rollback(); raise

def initialize_database(path: str) -> None:
    for attempt in range(3):
        c=_connect(path)
        try: _migrate(c); os.chmod(path,0o600); return
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower() or attempt==2: raise
            time.sleep(.25*(attempt+1))
        finally: c.close()

def check_database(path: str) -> bool:
    try:
        db=Path(path)
        if db.is_symlink() or not db.is_file(): return False
        with sqlite3.connect(db) as c:
            v=c.execute("PRAGMA user_version").fetchone()[0]; rows=dict(c.execute("SELECT key,value FROM runtime_metadata")); tables={x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        return v==5 and rows.get('schema_version')=='5' and rows.get('service_version')==SERVICE_VERSION and {'pairing_sessions','paired_devices','protocol_sessions','task_operations','tasks','task_reports','task_transitions'} <= tables
    except (OSError,sqlite3.Error,ValueError): return False

def _verifier(code: str, salt: bytes) -> bytes: return hashlib.scrypt(code.encode('ascii'),salt=salt,n=2**14,r=8,p=1,dklen=32)

def create_session(path: str, ttl: int=DEFAULT_TTL_SECONDS, now: str|None=None):
    if not 300<=ttl<=600: raise ValueError('ttl_out_of_range')
    created=now or utc_now(); expires=(datetime.fromisoformat(created.replace('Z','+00:00'))+timedelta(seconds=ttl)).isoformat().replace('+00:00','Z'); sid=_uuid4(); code=secrets.token_hex(16); salt=secrets.token_bytes(16)
    c=_connect(path)
    try:
        c.execute('BEGIN IMMEDIATE'); c.execute('INSERT INTO pairing_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)',(sid,salt,_verifier(code,salt),created,expires,0,MAX_ATTEMPTS,'ACTIVE',None,None,None)); c.execute('INSERT INTO pairing_audit_events VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),created,'session_created','success',sid,None,'created')); c.commit(); return sid,code,expires
    except Exception: c.rollback(); raise
    finally: c.close()

def session_status(path: str, session_id: str):
    with _connect(path) as c:
        row=c.execute('SELECT session_id,created_at,expires_at,attempt_count,max_attempts,status,consumed_at,paired_device_id,revoked_at FROM pairing_sessions WHERE session_id=?',(session_id,)).fetchone()
        return dict(zip(('session_id','created_at','expires_at','attempt_count','max_attempts','status','consumed_at','paired_device_id','revoked_at'),row)) if row else None

def revoke_session(path: str, session_id: str):
    c=_connect(path); now=utc_now()
    try:
        c.execute('BEGIN IMMEDIATE'); row=c.execute('SELECT status FROM pairing_sessions WHERE session_id=?',(session_id,)).fetchone()
        if not row: c.rollback(); return 'not_found',False
        if row[0]=='ACTIVE': c.execute('UPDATE pairing_sessions SET status="REVOKED",revoked_at=? WHERE session_id=?',(now,session_id)); c.execute('INSERT INTO pairing_audit_events VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),now,'session_revoked','success',session_id,None,'revoked')); c.commit(); return 'revoked',True
        c.commit(); return 'already_final',False
    except Exception: c.rollback(); raise
    finally: c.close()

def revoke_device(path: str, device_id: str):
    c=_connect(path); now=utc_now()
    try:
        c.execute('BEGIN IMMEDIATE'); row=c.execute('SELECT status FROM paired_devices WHERE device_id=?',(device_id,)).fetchone()
        if not row: c.rollback(); return 'not_found',False
        if row[0]=='ACTIVE': c.execute('UPDATE paired_devices SET status="REVOKED",revoked_at=? WHERE device_id=?',(now,device_id)); c.execute('INSERT INTO pairing_audit_events VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),now,'device_revoked','success',None,device_id,'revoked')); c.commit(); return 'revoked',True
        c.commit(); return 'already_revoked',False
    except Exception: c.rollback(); raise
    finally: c.close()

def device_status(path: str, device_id: str):
    with _connect(path) as c:
        row=c.execute('SELECT device_id,device_fingerprint,created_at,status,revoked_at,pairing_session_id FROM paired_devices WHERE device_id=?',(device_id,)).fetchone(); return dict(zip(('device_id','device_fingerprint','created_at','status','revoked_at','pairing_session_id'),row)) if row else None

def complete_pairing(path: str, session_id: str, code: str, public_key: str, now: str|None=None):
    current=now or utc_now(); c=_connect(path)
    try:
        c.execute('BEGIN IMMEDIATE'); row=c.execute('SELECT code_salt,code_verifier,expires_at,attempt_count,max_attempts,status FROM pairing_sessions WHERE session_id=?',(session_id,)).fetchone()
        if not row: c.execute('INSERT INTO pairing_audit_events VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),current,'pairing_rejected','rejected',None,None,'unknown_session')); c.commit(); return False,{'error':'pairing_rejected'}
        salt,expected,expires,attempts,maximum,status=row
        if status=='ACTIVE' and current>=expires: c.execute('UPDATE pairing_sessions SET status="EXPIRED" WHERE session_id=?',(session_id,)); status='EXPIRED'
        if status!='ACTIVE': c.execute('INSERT INTO pairing_audit_events VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),current,'pairing_rejected','rejected',session_id,None,'session_unavailable')); c.commit(); return False,{'error':'pairing_rejected'}
        try: valid=hmac.compare_digest(_verifier(code,salt),expected)
        except (UnicodeError,ValueError): valid=False
        if not valid:
            attempts+=1; ns='LOCKED' if attempts>=maximum else 'ACTIVE'; c.execute('UPDATE pairing_sessions SET attempt_count=?,status=? WHERE session_id=? AND status="ACTIVE"',(attempts,ns,session_id)); c.execute('INSERT INTO pairing_audit_events VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),current,'pairing_rejected','rejected',session_id,None,'invalid_code')); c.commit(); return False,{'error':'pairing_rejected'}
        device=_uuid4(); fp='sha256:'+hashlib.sha256(public_key.encode('ascii')).hexdigest(); c.execute('INSERT INTO paired_devices VALUES(?,?,?,?,?,?,?)',(device,public_key,fp,current,'ACTIVE',None,session_id)); c.execute('UPDATE pairing_sessions SET status="CONSUMED",consumed_at=?,paired_device_id=? WHERE session_id=?',(current,device,session_id)); c.execute('INSERT INTO pairing_audit_events VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),current,'pairing_completed','success',session_id,device,'paired')); c.commit(); return True,{'pairing_version':'1','device_id':device,'device_fingerprint':fp,'status':'ACTIVE','paired_at':current}
    except sqlite3.IntegrityError: c.rollback(); return False,{'error':'pairing_rejected'}
    except Exception: c.rollback(); raise
    finally: c.close()
