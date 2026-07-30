"""Direct-only protected task/report state machine.

The adapter is intentionally in-process and deterministic; it never starts a
subprocess and it stores hashes, not task payloads or report bodies in logs.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from .database import _connect, utc_now

APP_VERSION = "0.7.0"
STATES = {"ACCEPTED", "SUCCEEDED", "CANCELLED"}


def _uuid4(value: object) -> str:
    if not isinstance(value, str) or value != value.lower():
        raise ValueError("invalid_task_request")
    try:
        u = uuid.UUID(value)
    except (ValueError, AttributeError):
        raise ValueError("invalid_task_request")
    if u.version != 4 or str(u) != value:
        raise ValueError("invalid_task_request")
    return value


def _depth(value: object, level: int = 0) -> int:
    if isinstance(value, dict):
        return max([level] + [_depth(v, level + 1) for v in value.values()])
    if isinstance(value, list):
        return max([level] + [_depth(v, level + 1) for v in value])
    return level


def _validate_payload(value: object, limit: int = 2048) -> bytes:
    if not isinstance(value, dict):
        raise ValueError("invalid_task_request")
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    if len(raw) > limit or _depth(value) > 8:
        raise ValueError("invalid_task_request")
    def walk(v: object) -> None:
        if isinstance(v, str) and len(v.encode()) > 512: raise ValueError("invalid_task_request")
        if isinstance(v, dict):
            if len(v) > 64: raise ValueError("invalid_task_request")
            for k, x in v.items():
                if not isinstance(k, str) or len(k.encode()) > 512: raise ValueError("invalid_task_request")
                walk(x)
        elif isinstance(v, list):
            if len(v) > 64: raise ValueError("invalid_task_request")
            for x in v: walk(x)
    walk(value)
    return raw


def canonical_request(message: dict) -> tuple[str, str]:
    if message.get("type") != "task_create":
        raise ValueError("invalid_task_request")
    op = _uuid4(message.get("operation_id"))
    mode = message.get("execution_mode")
    if mode not in {"complete_immediately", "remain_pending"}:
        raise ValueError("invalid_task_request")
    payload_raw = _validate_payload(message.get("task_payload"))
    canonical = json.dumps({"application_version": APP_VERSION, "task_payload": json.loads(payload_raw), "execution_mode": mode}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return op, hashlib.sha256(canonical).hexdigest()


def _safe_task(row: sqlite3.Row | tuple) -> dict:
    keys = ("task_id", "operation_id", "state", "task_payload_sha256", "execution_count", "accepted_at", "updated_at", "completed_at")
    return dict(zip(keys, row))


def create(path: str, device_id: str, message: dict) -> tuple[dict, str | None]:
    operation_id, digest = canonical_request(message)
    mode = message["execution_mode"]
    payload_digest = hashlib.sha256(_validate_payload(message["task_payload"])).hexdigest()
    now = utc_now()
    c = _connect(path)
    try:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT task_id,canonical_request_sha256 FROM task_operations WHERE device_id=? AND operation_id=?", (device_id, operation_id)).fetchone()
        if row:
            c.rollback()
            if row[1] != digest: return {}, "operation_payload_conflict"
            return lookup(path, device_id, row[0]), None
        task_id = str(uuid.uuid4())
        c.execute("INSERT INTO task_operations VALUES (?,?,?,?,?)", (device_id, operation_id, digest, task_id, now))
        state = "SUCCEEDED" if mode == "complete_immediately" else "ACCEPTED"
        completed = now if state == "SUCCEEDED" else None
        count = 1 if state == "SUCCEEDED" else 0
        c.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)", (task_id, device_id, operation_id, state, payload_digest, mode, count, now, now, completed))
        if state == "SUCCEEDED":
            report = {"report_id": str(uuid.uuid4()), "task_id": task_id, "operation_id": operation_id, "state": state, "task_payload_sha256": payload_digest, "execution_count": 1, "accepted_at": now, "completed_at": now}
            encoded = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            c.execute("INSERT INTO task_reports VALUES (?,?,?,?,?,?)", (report["report_id"], task_id, device_id, hashlib.sha256(encoded.encode()).hexdigest(), encoded, now))
        c.commit()
        return lookup(path, device_id, task_id), None
    except Exception:
        c.rollback(); raise
    finally: c.close()


def lookup(path: str, device_id: str, ref: str) -> dict:
    c = _connect(path)
    try:
        row = c.execute("SELECT t.task_id,t.operation_id,t.state,t.task_payload_sha256,t.execution_count,t.accepted_at,t.updated_at,t.completed_at FROM tasks t WHERE t.device_id=? AND (t.task_id=? OR t.operation_id=?)", (device_id, ref, ref)).fetchone()
        if not row: raise ValueError("task_not_found")
        return _safe_task(row)
    finally: c.close()


def cancel(path: str, device_id: str, ref: str) -> tuple[dict, str | None]:
    c = _connect(path)
    try:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT task_id,operation_id,state,task_payload_sha256,execution_count,accepted_at,updated_at,completed_at FROM tasks WHERE device_id=? AND (task_id=? OR operation_id=?)", (device_id, ref, ref)).fetchone()
        if not row: c.rollback(); return {}, "task_not_found"
        if row[2] == "ACCEPTED":
            now = utc_now(); c.execute("UPDATE tasks SET state='CANCELLED',updated_at=?,completed_at=? WHERE task_id=?", (now, now, row[0])); c.commit()
            return lookup(path, device_id, row[0]), None
        c.rollback()
        if row[2] == "SUCCEEDED": return {}, "not_cancellable"
        return _safe_task(row), None
    except Exception:
        c.rollback(); raise
    finally: c.close()


def report(path: str, device_id: str, ref: str) -> tuple[dict, str | None]:
    c = _connect(path)
    try:
        row = c.execute("SELECT task_id,operation_id,state FROM tasks WHERE device_id=? AND (task_id=? OR operation_id=?)", (device_id, ref, ref)).fetchone()
        if not row: return {}, "task_not_found"
        out = c.execute("SELECT report_id,content_hash,report_json FROM task_reports WHERE task_id=? AND device_id=?", (row[0], device_id)).fetchone()
        if not out: return {}, "report_not_available"
        value = json.loads(out[2]); value["content_hash"] = out[1]; return value, None
    finally: c.close()
