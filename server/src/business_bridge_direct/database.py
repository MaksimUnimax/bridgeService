"""Direct runtime database and the one-time pairing state machine."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import uuid
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 2
MAX_ATTEMPTS = 5
DEFAULT_TTL_SECONDS = 600


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _uuid4(value: str | None = None) -> str:
    value = value or str(uuid.uuid4())
    if str(uuid.UUID(value)) != value.lower() or uuid.UUID(value).version != 4 or value != value.lower():
        raise ValueError("invalid uuid")
    return value


def _connect(path: str) -> sqlite3.Connection:
    db = Path(path)
    if db.is_symlink() or (db.exists() and not db.is_file()):
        raise ValueError("invalid database file")
    db.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(db, timeout=2.0, isolation_level=None)
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _create_pairing_tables(c: sqlite3.Connection) -> None:
    statements = ["""
    CREATE TABLE IF NOT EXISTS pairing_sessions (
      session_id TEXT PRIMARY KEY CHECK (length(session_id)=36),
      code_salt BLOB NOT NULL,
      code_verifier BLOB NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
      status TEXT NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED','LOCKED','REVOKED')),
      consumed_at TEXT, paired_device_id TEXT, revoked_at TEXT
    )""", """
    CREATE TABLE IF NOT EXISTS paired_devices (
      device_id TEXT PRIMARY KEY CHECK (length(device_id)=36),
      public_key_spki TEXT NOT NULL,
      device_fingerprint TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
      revoked_at TEXT, pairing_session_id TEXT NOT NULL UNIQUE,
      FOREIGN KEY(pairing_session_id) REFERENCES pairing_sessions(session_id)
    )""", """
    CREATE TABLE IF NOT EXISTS pairing_audit_events (
      audit_event_id TEXT PRIMARY KEY, event_time TEXT NOT NULL,
      event_type TEXT NOT NULL, result_class TEXT NOT NULL,
      session_id TEXT, device_id TEXT, reason_code TEXT
    )"""]
    for statement in statements:
        c.execute(statement)


def _migrate(c: sqlite3.Connection) -> None:
    c.execute("BEGIN IMMEDIATE")
    try:
        version = int(c.execute("PRAGMA user_version").fetchone()[0])
        if version == 0:
            c.execute("CREATE TABLE IF NOT EXISTS runtime_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            c.execute("PRAGMA user_version=1")
            version = 1
        if version == 1:
            _create_pairing_tables(c)
            c.execute("INSERT OR REPLACE INTO runtime_metadata(key,value) VALUES('schema_version','2')")
            c.execute("INSERT OR REPLACE INTO runtime_metadata(key,value) VALUES('service_version','0.5.0')")
            c.execute("PRAGMA user_version=2")
        elif version != 2:
            raise ValueError("unsupported schema")
        else:
            _create_pairing_tables(c)
            c.execute("INSERT OR REPLACE INTO runtime_metadata(key,value) VALUES('schema_version','2')")
            c.execute("INSERT OR REPLACE INTO runtime_metadata(key,value) VALUES('service_version','0.5.0')")
        c.commit()
    except Exception:
        c.rollback()
        raise


def initialize_database(path: str) -> None:
    # A controlled systemd restart can briefly overlap the old process while
    # it closes its SQLite handle.  Retry only the bounded lock condition;
    # schema and permission errors remain fail-closed.
    for attempt in range(3):
        c = _connect(path)
        try:
            _migrate(c)
            os.chmod(path, 0o600)
            return
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).lower() or attempt == 2:
                raise
            time.sleep(0.25 * (attempt + 1))
        finally:
            c.close()


def check_database(path: str) -> bool:
    try:
        db = Path(path)
        if db.is_symlink() or not db.is_file(): return False
        c = sqlite3.connect(db, timeout=0.2)
        version = c.execute("PRAGMA user_version").fetchone()[0]
        rows = dict(c.execute("SELECT key,value FROM runtime_metadata"))
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        c.close()
        return version == 2 and rows.get("schema_version") == "2" and rows.get("service_version") == "0.5.0" and {"pairing_sessions","paired_devices","pairing_audit_events"} <= tables
    except (OSError, sqlite3.Error, ValueError):
        return False


def _verifier(code: str, salt: bytes) -> bytes:
    return hashlib.scrypt(code.encode("ascii"), salt=salt, n=2**14, r=8, p=1, dklen=32)


def create_session(path: str, ttl: int = DEFAULT_TTL_SECONDS, now: str | None = None) -> tuple[str, str, str]:
    if not 300 <= ttl <= 600: raise ValueError("ttl_out_of_range")
    created = now or utc_now()
    from datetime import timedelta
    expires = (datetime.fromisoformat(created.replace("Z", "+00:00")) + timedelta(seconds=ttl)).isoformat().replace("+00:00", "Z")
    session = _uuid4(); code = secrets.token_hex(16); salt = secrets.token_bytes(16)
    c = _connect(path)
    try:
        c.execute("BEGIN IMMEDIATE")
        c.execute("INSERT INTO pairing_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?)", (session, salt, _verifier(code, salt), created, expires, 0, MAX_ATTEMPTS, "ACTIVE", None, None, None))
        c.execute("INSERT INTO pairing_audit_events VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()), created, "session_created", "success", session, None, "created"))
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK"); raise
    finally: c.close()
    return session, code, expires


def session_status(path: str, session_id: str) -> dict[str, object] | None:
    c = _connect(path)
    try:
        row = c.execute("SELECT session_id,created_at,expires_at,attempt_count,max_attempts,status,consumed_at,paired_device_id,revoked_at FROM pairing_sessions WHERE session_id=?", (session_id,)).fetchone()
        return dict(zip(("session_id","created_at","expires_at","attempt_count","max_attempts","status","consumed_at","paired_device_id","revoked_at"), row)) if row else None
    finally: c.close()


def revoke_session(path: str, session_id: str) -> tuple[str, bool]:
    c = _connect(path); now = utc_now()
    try:
        c.execute("BEGIN IMMEDIATE"); row = c.execute("SELECT status FROM pairing_sessions WHERE session_id=?", (session_id,)).fetchone()
        if not row: c.execute("ROLLBACK"); return "not_found", False
        if row[0] == "ACTIVE":
            c.execute("UPDATE pairing_sessions SET status='REVOKED',revoked_at=? WHERE session_id=?", (now,session_id)); c.execute("INSERT INTO pairing_audit_events VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()),now,"session_revoked","success",session_id,None,"revoked")); c.execute("COMMIT"); return "revoked", True
        c.execute("COMMIT"); return "already_final", False
    except Exception: c.execute("ROLLBACK"); raise
    finally: c.close()


def revoke_device(path: str, device_id: str) -> tuple[str, bool]:
    c = _connect(path); now = utc_now()
    try:
        c.execute("BEGIN IMMEDIATE"); row = c.execute("SELECT status FROM paired_devices WHERE device_id=?", (device_id,)).fetchone()
        if not row: c.execute("ROLLBACK"); return "not_found", False
        if row[0] == "ACTIVE":
            c.execute("UPDATE paired_devices SET status='REVOKED',revoked_at=? WHERE device_id=?", (now,device_id)); c.execute("INSERT INTO pairing_audit_events VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()),now,"device_revoked","success",None,device_id,"revoked")); c.execute("COMMIT"); return "revoked", True
        c.execute("COMMIT"); return "already_revoked", False
    except Exception: c.execute("ROLLBACK"); raise
    finally: c.close()


def device_status(path: str, device_id: str) -> dict[str, object] | None:
    c = _connect(path)
    try:
        row = c.execute("SELECT device_id,device_fingerprint,created_at,status,revoked_at,pairing_session_id FROM paired_devices WHERE device_id=?", (device_id,)).fetchone()
        return dict(zip(("device_id","device_fingerprint","created_at","status","revoked_at","pairing_session_id"), row)) if row else None
    finally: c.close()


def complete_pairing(path: str, session_id: str, code: str, public_key: str, now: str | None = None) -> tuple[bool, dict[str, str]]:
    current = now or utc_now(); c = _connect(path)
    try:
        c.execute("BEGIN IMMEDIATE"); row = c.execute("SELECT code_salt,code_verifier,expires_at,attempt_count,max_attempts,status FROM pairing_sessions WHERE session_id=?", (session_id,)).fetchone()
        if not row:
            c.execute("INSERT INTO pairing_audit_events VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()),current,"pairing_rejected","rejected",None,None,"unknown_session")); c.execute("COMMIT"); return False, {"error":"pairing_rejected"}
        salt, expected, expires, attempts, maximum, status = row
        if status == "ACTIVE" and current >= expires:
            c.execute("UPDATE pairing_sessions SET status='EXPIRED' WHERE session_id=?", (session_id,)); status="EXPIRED"
        if status != "ACTIVE":
            c.execute("INSERT INTO pairing_audit_events VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()),current,"pairing_rejected","rejected",session_id,None,"session_unavailable")); c.execute("COMMIT"); return False, {"error":"pairing_rejected"}
        valid = False
        try: valid = hmac.compare_digest(_verifier(code, salt), expected)
        except (UnicodeError, ValueError): valid = False
        if not valid:
            attempts += 1; new_status = "LOCKED" if attempts >= maximum else "ACTIVE"
            c.execute("UPDATE pairing_sessions SET attempt_count=?,status=? WHERE session_id=? AND status='ACTIVE'", (attempts,new_status,session_id)); c.execute("INSERT INTO pairing_audit_events VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()),current,"pairing_rejected","rejected",session_id,None,"invalid_code")); c.execute("COMMIT"); return False, {"error":"pairing_rejected"}
        device = _uuid4(); fingerprint = "sha256:" + hashlib.sha256(public_key.encode("ascii")).hexdigest()
        c.execute("INSERT INTO paired_devices VALUES (?,?,?,?,?,?,?)", (device,public_key,fingerprint,current,"ACTIVE",None,session_id))
        c.execute("UPDATE pairing_sessions SET status='CONSUMED',consumed_at=?,paired_device_id=? WHERE session_id=? AND status='ACTIVE'", (current,device,session_id))
        c.execute("INSERT INTO pairing_audit_events VALUES (?,?,?,?,?,?,?)", (str(uuid.uuid4()),current,"pairing_completed","success",session_id,device,"paired")); c.execute("COMMIT")
        return True, {"pairing_version":"1","device_id":device,"device_fingerprint":fingerprint,"status":"ACTIVE","paired_at":current}
    except sqlite3.IntegrityError:
        c.execute("ROLLBACK"); return False, {"error":"pairing_rejected"}
    except Exception: c.execute("ROLLBACK"); raise
    finally: c.close()
