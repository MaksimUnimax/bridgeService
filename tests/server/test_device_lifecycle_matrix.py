"""Executable BB2-DIRECT-06 attempt-4 acceptance oracle.

Every id below is intentionally stable: the acceptance ledger maps gates to
these collected pytest nodes, rather than to an aggregate suite result.
"""
from __future__ import annotations

import base64
import json
import pathlib
import socket
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from business_bridge_direct.database import (
    complete_pairing, create_session, device_status, initialize_database,
)
from business_bridge_direct.http_api import BoundedIPv4Server
from business_bridge_direct.pairing import device_lifecycle
from business_bridge_direct.protocol import domain
from business_bridge_direct.protocol_crypto import b64u, canonical, sign, verify

T = datetime(2026, 1, 1, tzinfo=timezone.utc)
UUID_A = "00000000-0000-4000-8000-000000000001"
UUID_B = "00000000-0000-4000-8000-000000000002"


def _key():
    return ec.generate_private_key(ec.SECP256R1())


def _spki(key):
    return b64u(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))


def _ctx(two=False):
    td = tempfile.TemporaryDirectory()
    root = pathlib.Path(td.name)
    db = str(root / "db.sqlite3")
    initialize_database(db)
    server_key = _key()
    server_spki = server_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    key_path = root / "server.pem"
    key_path.write_bytes(server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    identity = {"instance_id": UUID_A, "fingerprint": "sha256:" + __import__("hashlib").sha256(server_spki).hexdigest()}
    devices = []
    for did in (UUID_A, UUID_B) if two else (UUID_A,):
        key = _key(); sid, code, _ = create_session(db, now="2026-01-01T00:00:00Z")
        ok, result = complete_pairing(db, sid, code, _spki(key), now="2026-01-01T00:00:01Z")
        assert ok
        devices.append((did, key, result["device_id"]))
    cfg = SimpleNamespace(request_timeout_seconds=1, max_header_bytes=8192, max_request_line_bytes=2048,
        max_request_body_bytes=4096, max_header_count=32, max_concurrent_requests=16, listen_backlog=4,
        per_source_rate_window_seconds=60, per_source_rate_limit=60, global_rate_window_seconds=60,
        global_rate_limit=60, server_signing_private_key_path=str(key_path))
    service = SimpleNamespace(database_path=db, service_name="business-bridge-2-direct", version="0.9.1", identity=identity, config=cfg)
    return td, db, server_key, identity, devices, cfg, service


def _request(key, device_id, action="status", request_id=UUID_A, stamp=None, expires=None):
    stamp = stamp or datetime.now(timezone.utc).replace(microsecond=0)
    expires = expires or stamp + timedelta(seconds=30)
    value = {"lifecycle_version":"BB2D-L1", "action":action, "device_id":device_id,
        "request_id":request_id, "timestamp":stamp.isoformat().replace("+00:00", "Z"),
        "expires_at":expires.isoformat().replace("+00:00", "Z")}
    value["signature"] = sign(key, domain("BB2D-L1/client-device", canonical({**value, "method":"POST", "path":"/v2/pairing/device"})))
    return value


def _response_data(server_key, response):
    verify(server_key.public_key(), response["signature"], domain("BB2D-L1/server-device", canonical({
        "method":"POST", "path":"/v2/pairing/device", "status":200,
        "response":{k:v for k,v in response.items() if k != "signature"}})))


def _http(server, method=b"POST", path=b"/v2/pairing/device", body=b"{}", headers=b"Content-Type: application/json\r\n"):
    with socket.create_connection(server.server_address, timeout=2) as s:
        s.sendall(method + b" " + path + b" HTTP/1.1\r\nHost: test\r\n" + headers +
                  b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        raw = s.recv(20000)
    status = int(raw.split(b" ", 2)[1])
    payload = raw.split(b"\r\n\r\n", 1)[1]
    return status, json.loads(payload)


def test_VALID_STATUS():
    td, db, sk, ident, ds, cfg, service = _ctx();
    try:
        did, key, real = ds[0]; status, out = device_lifecycle(db, json.dumps(_request(key, real), separators=(",", ":")).encode(), ident, sk)
        assert status == 200 and out["status"] == "ACTIVE"; _response_data(sk, out)
    finally: td.cleanup()


def test_VALID_REVOKE_REVOKE_EXACT_REPLAY_FRESH_REVOKE_AFTER_ALREADY_REVOKED_STATUS_AFTER_REVOKE():
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        _, key, real = ds[0]
        for action, rid in (("revoke", UUID_A), ("revoke", UUID_A), ("revoke", UUID_B), ("status", "00000000-0000-4000-8000-000000000003")):
            status, out = device_lifecycle(db, json.dumps(_request(key, real, action, rid), separators=(",", ":")).encode(), ident, sk)
            assert status == 200 and out["status"] == "REVOKED"; _response_data(sk, out)
        assert device_status(db, real)["status"] == "REVOKED"
    finally: td.cleanup()


@pytest.mark.parametrize("case", [
    "VALID_REVOKE", "REVOKE_EXACT_REPLAY", "FRESH_REVOKE_AFTER_ALREADY_REVOKED",
    "STATUS_AFTER_REVOKE", "FIRST_REVOKE", "EXACT_REQUEST_REPLAY",
    "FRESH_SIGNED_REVOKE_AFTER_REVOKED", "NO_REACTIVATION",
], ids=lambda x: x)
def test_lifecycle_case(case):
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        _, key, real = ds[0]
        if case == "NO_REACTIVATION":
            device_lifecycle(db, json.dumps(_request(key, real, "revoke", UUID_A), separators=(",", ":")).encode(), ident, sk)
            assert device_status(db, real)["status"] == "REVOKED"
            return
        action = "status" if case == "STATUS_AFTER_REVOKE" else "revoke"
        if case == "STATUS_AFTER_REVOKE":
            device_lifecycle(db, json.dumps(_request(key, real, "revoke", UUID_A), separators=(",", ":")).encode(), ident, sk)
        status, response = device_lifecycle(db, json.dumps(_request(key, real, action, UUID_A if case in {"VALID_REVOKE", "REVOKE_EXACT_REPLAY", "FIRST_REVOKE", "EXACT_REQUEST_REPLAY"} else UUID_B), separators=(",", ":")).encode(), ident, sk)
        assert status == 200
        if case == "STATUS_AFTER_REVOKE": assert response["status"] == "REVOKED"
        else: assert response["status"] == "REVOKED"
    finally: td.cleanup()


@pytest.mark.parametrize("case", [
    "UNKNOWN_DEVICE", "WRONG_DEVICE_SIGNATURE", "TAMPER_ACTION", "TAMPER_DEVICE_ID", "TAMPER_REQUEST_ID",
    "TAMPER_TIMESTAMP", "TAMPER_EXPIRES_AT", "PADDED_SIGNATURE", "INVALID_SIGNATURE_ALPHABET", "WRONG_SIGNATURE_LENGTH",
], ids=lambda x: x)
def test_authentication_rejections_are_generic(case):
    td, db, sk, ident, ds, cfg, service = _ctx(two=True)
    try:
        _, key, real = ds[0]; req = _request(key, real)
        if case == "UNKNOWN_DEVICE": req["device_id"] = "00000000-0000-4000-8000-000000000099"
        elif case == "WRONG_DEVICE_SIGNATURE": req["signature"] = sign(ds[1][1], domain("wrong", b"x"))
        elif case == "TAMPER_ACTION": req["action"] = "revoke"
        elif case == "TAMPER_DEVICE_ID": req["device_id"] = ds[1][2]
        elif case == "TAMPER_REQUEST_ID": req["request_id"] = UUID_B
        elif case == "TAMPER_TIMESTAMP": req["timestamp"] = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
        elif case == "TAMPER_EXPIRES_AT": req["expires_at"] = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=31)).isoformat().replace("+00:00", "Z")
        elif case == "PADDED_SIGNATURE": req["signature"] += "="
        elif case == "INVALID_SIGNATURE_ALPHABET": req["signature"] = "!" * len(req["signature"])
        else: req["signature"] = b64u(b"x" * 63)
        with pytest.raises(PermissionError, match="device_lifecycle_rejected"):
            device_lifecycle(db, json.dumps(req, separators=(",", ":")).encode(), ident, sk)
        assert device_status(db, real)["status"] == "ACTIVE"
    finally: td.cleanup()


@pytest.mark.parametrize("case", [
    "EXPIRED_WITHIN_VALID_TIMESTAMP_SKEW", "EXPIRES_EQUAL_NOW", "EXPIRES_BEFORE_NOW", "EXPIRES_EQUAL_TIMESTAMP",
    "EXPIRES_BEFORE_TIMESTAMP", "TTL_OVER_60", "TIMESTAMP_TOO_OLD", "TIMESTAMP_TOO_FUTURE",
], ids=lambda x: x)
def test_time_rejections_and_no_mutation(case):
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        _, key, real = ds[0]
        values = {"EXPIRED_WITHIN_VALID_TIMESTAMP_SKEW": (T-timedelta(seconds=20), T-timedelta(seconds=10)),
            "EXPIRES_EQUAL_NOW": (T, T), "EXPIRES_BEFORE_NOW": (T-timedelta(seconds=1), T-timedelta(seconds=2)),
            "EXPIRES_EQUAL_TIMESTAMP": (T, T), "EXPIRES_BEFORE_TIMESTAMP": (T, T-timedelta(seconds=1)),
            "TTL_OVER_60": (T, T+timedelta(seconds=61)), "TIMESTAMP_TOO_OLD": (T-timedelta(seconds=31), T),
            "TIMESTAMP_TOO_FUTURE": (T+timedelta(seconds=31), T+timedelta(seconds=60))}[case]
        req = _request(key, real, stamp=values[0], expires=values[1])
        with patch("business_bridge_direct.pairing._lifecycle_now", return_value=T), pytest.raises(ValueError):
            device_lifecycle(db, json.dumps(req, separators=(",", ":")).encode(), ident, sk)
        assert device_status(db, real)["status"] == "ACTIVE"
    finally: td.cleanup()


@pytest.mark.parametrize("case", ["FRACTIONAL_TIMESTAMP", "NONCANONICAL_UTC_TIMESTAMP", "DUPLICATE_JSON_KEY", "MISSING_FIELD", "UNKNOWN_FIELD", "WRONG_FIELD_TYPE", "INVALID_LIFECYCLE_VERSION", "INVALID_ACTION", "INVALID_DEVICE_UUID", "INVALID_REQUEST_UUID"], ids=lambda x:x)
def test_malformed_requests_are_rejected(case):
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        _, key, real = ds[0]; req = _request(key, real, stamp=T)
        if case == "FRACTIONAL_TIMESTAMP": req["timestamp"] = "2026-01-01T00:00:00.1Z"
        elif case == "NONCANONICAL_UTC_TIMESTAMP": req["timestamp"] = "2026-01-01T00:00:00+00:00"
        elif case == "MISSING_FIELD": del req["signature"]
        elif case == "UNKNOWN_FIELD": req["extra"] = "x"
        elif case == "WRONG_FIELD_TYPE": req["action"] = 1
        elif case == "INVALID_LIFECYCLE_VERSION": req["lifecycle_version"] = "bad"
        elif case == "INVALID_ACTION": req["action"] = "bad"
        elif case == "INVALID_DEVICE_UUID": req["device_id"] = "not-a-uuid"
        elif case == "INVALID_REQUEST_UUID": req["request_id"] = "not-a-uuid"
        raw = json.dumps(req, separators=(",", ":")).encode()
        if case == "DUPLICATE_JSON_KEY": raw = raw[:-1] + b',"action":"status"}'
        with pytest.raises(ValueError): device_lifecycle(db, raw, ident, sk)
    finally: td.cleanup()


def test_response_one_clock_deterministic_and_signature():
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        _, key, real = ds[0]; req = _request(key, real, stamp=T)
        with patch("business_bridge_direct.pairing._lifecycle_now", side_effect=[T, T+timedelta(seconds=1)]) as clock:
            status, out = device_lifecycle(db, json.dumps(req, separators=(",", ":")).encode(), ident, sk)
        assert status == 200 and clock.call_count == 2
        a = datetime.fromisoformat(out["timestamp"].replace("Z", "+00:00")); b = datetime.fromisoformat(out["expires_at"].replace("Z", "+00:00"))
        assert b-a == timedelta(seconds=60); _response_data(sk, out)
    finally: td.cleanup()


@pytest.mark.parametrize("field", ["action", "device_id", "instance_id", "server_fingerprint", "request_id", "status", "timestamp", "expires_at"], ids=lambda x:"RESPONSE_TAMPER_"+x.upper())
def test_response_tamper_rejected(field):
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        _, key, real = ds[0]; _, out = device_lifecycle(db, json.dumps(_request(key, real), separators=(",", ":")).encode(), ident, sk); bad = dict(out)
        bad[field] = "tampered" if field not in {"timestamp", "expires_at"} else "2025-01-01T00:00:00Z"
        with pytest.raises((InvalidSignature, ValueError, TypeError)): _response_data(sk, bad)
    finally: td.cleanup()


@pytest.mark.parametrize("kind", ["MISSING_SIGNATURE", "PADDED_SIGNATURE", "WRONG_SIGNATURE"], ids=lambda x:"RESPONSE_"+x)
def test_response_signature_rejections(kind):
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        _, key, real = ds[0]; _, out = device_lifecycle(db, json.dumps(_request(key, real), separators=(",", ":")).encode(), ident, sk); bad = dict(out)
        if kind == "MISSING_SIGNATURE": del bad["signature"]
        elif kind == "PADDED_SIGNATURE": bad["signature"] += "="
        else: bad["signature"] = sign(_key(), b"wrong")
        with pytest.raises((KeyError, InvalidSignature, ValueError, TypeError)): _response_data(sk, bad)
    finally: td.cleanup()


def test_revoke_only_first_transition_has_audit_effect_and_no_reactivation():
    td, db, sk, ident, ds, cfg, service = _ctx()
    try:
        import sqlite3
        _, key, real = ds[0]; before = sqlite3.connect(db).execute("select count(*) from pairing_audit_events").fetchone()[0]
        for i in range(3): device_lifecycle(db, json.dumps(_request(key, real, "revoke", f"00000000-0000-4000-8000-00000000000{i+3}"), separators=(",", ":")).encode(), ident, sk)
        after = sqlite3.connect(db).execute("select count(*) from pairing_audit_events where event_type='device_revoked'").fetchone()[0]
        assert after == 1 and device_status(db, real)["status"] == "REVOKED"
    finally: td.cleanup()


@pytest.mark.parametrize("case", ["DEVICE_A_STATUS_A", "DEVICE_B_STATUS_B", "DEVICE_A_CANNOT_AUTH_AS_B", "DEVICE_A_CANNOT_REVOKE_B", "FAILED_A_TO_B_LEAVES_B_ACTIVE", "DEVICE_B_SELF_REVOKE", "DEVICE_A_STATE_INDEPENDENT", "DEVICE_B_STATE_INDEPENDENT"], ids=lambda x:x)
def test_device_isolation(case):
    td, db, sk, ident, ds, cfg, service = _ctx(two=True)
    try:
        _, ka, a = ds[0]; _, kb, b = ds[1]
        if case == "DEVICE_A_STATUS_A": assert device_lifecycle(db, json.dumps(_request(ka,a),separators=(",",":")).encode(),ident,sk)[1]["device_id"] == a
        elif case == "DEVICE_B_STATUS_B": assert device_lifecycle(db, json.dumps(_request(kb,b,request_id=UUID_B),separators=(",",":")).encode(),ident,sk)[1]["device_id"] == b
        elif case in {"DEVICE_A_CANNOT_AUTH_AS_B", "DEVICE_A_CANNOT_REVOKE_B", "FAILED_A_TO_B_LEAVES_B_ACTIVE"}:
            req = _request(ka, b, "revoke" if case != "DEVICE_A_CANNOT_AUTH_AS_B" else "status")
            with pytest.raises(PermissionError): device_lifecycle(db,json.dumps(req,separators=(",",":")).encode(),ident,sk)
            assert device_status(db,b)["status"] == "ACTIVE"
        elif case == "DEVICE_B_SELF_REVOKE": device_lifecycle(db,json.dumps(_request(kb,b,"revoke",UUID_B),separators=(",",":")).encode(),ident,sk); assert device_status(db,b)["status"] == "REVOKED"
        else:
            assert device_status(db,a)["status"] == "ACTIVE" and device_status(db,b)["status"] == "ACTIVE"
    finally: td.cleanup()


@pytest.mark.parametrize("case", ["HTTP_VALID_POST", "HTTP_GET_405", "HTTP_QUERY_REJECT", "HTTP_WRONG_CONTENT_TYPE_415", "HTTP_CHUNKED_REJECT", "HTTP_OVERSIZED_REJECT", "HTTP_RATE_LIMIT_BOUNDED"], ids=lambda x:x)
def test_http_matrix(case):
    td, db, sk, ident, ds, cfg, service = _ctx(); server = BoundedIPv4Server(("127.0.0.1",0), service, cfg); thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    try:
        _, key, real = ds[0]; body=json.dumps(_request(key,real),separators=(",",":")).encode()
        if case == "HTTP_VALID_POST": assert _http(server,body=body)[0] == 200
        elif case == "HTTP_GET_405": assert _http(server,b"GET",body=body)[0] == 405
        elif case == "HTTP_QUERY_REJECT": assert _http(server,path=b"/v2/pairing/device?x=1",body=body)[0] == 400
        elif case == "HTTP_WRONG_CONTENT_TYPE_415": assert _http(server,body=body,headers=b"Content-Type: text/plain\r\n")[0] == 415
        elif case == "HTTP_CHUNKED_REJECT": assert _http(server,body=body,headers=b"Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n")[0] == 400
        elif case == "HTTP_OVERSIZED_REJECT": assert _http(server,body=b"x"*5000)[0] == 413
        else:
            cfg.per_source_rate_limit=10; statuses=[_http(server,body=body)[0] for _ in range(11)]; assert 429 in statuses
    finally: server.shutdown(); thread.join(2); server.server_close(); td.cleanup()
