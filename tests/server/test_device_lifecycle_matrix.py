"""BB2-DIRECT-06 attempt-6, gate-numbered lifecycle oracle.

The names in this module are part of the acceptance contract.  A gate may
refer to a node only when that exact node is present in pytest collection.
The critical lifecycle cases deliberately construct and retain their exact
serialized request bytes so that the oracle proves its own preconditions.
"""
from __future__ import annotations

import json
import pathlib
import socket
import sqlite3
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
    return b64u(key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ))


def _ctx(two=False):
    td = tempfile.TemporaryDirectory()
    root = pathlib.Path(td.name)
    db = str(root / "db.sqlite3")
    initialize_database(db)
    server_key = _key()
    server_spki = server_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    key_path = root / "server.pem"
    key_path.write_bytes(server_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))
    identity = {
        "instance_id": UUID_A,
        "fingerprint": "sha256:" + __import__("hashlib").sha256(server_spki).hexdigest(),
    }
    devices = []
    for label in (UUID_A, UUID_B) if two else (UUID_A,):
        key = _key()
        sid, code, _ = create_session(db, now="2026-01-01T00:00:00Z")
        ok, result = complete_pairing(
            db, sid, code, _spki(key), now="2026-01-01T00:00:01Z")
        assert ok
        devices.append((label, key, result["device_id"]))
    cfg = SimpleNamespace(
        request_timeout_seconds=1, max_header_bytes=8192,
        max_request_line_bytes=2048, max_request_body_bytes=4096,
        max_header_count=32, max_concurrent_requests=16, listen_backlog=4,
        per_source_rate_window_seconds=60, per_source_rate_limit=60,
        global_rate_window_seconds=60, global_rate_limit=60,
        server_signing_private_key_path=str(key_path),
    )
    service = SimpleNamespace(
        database_path=db, service_name="business-bridge-2-direct", version="0.9.1",
        identity=identity, config=cfg,
    )
    return td, db, server_key, identity, devices, cfg, service


def _request(key, device_id, action="status", request_id=UUID_A,
             stamp=None, expires=None):
    stamp = datetime.now(timezone.utc).replace(microsecond=0) if stamp is None else stamp
    expires = stamp + timedelta(seconds=30) if expires is None else expires
    value = {
        "lifecycle_version": "BB2D-L1", "action": action,
        "device_id": device_id, "request_id": request_id,
        "timestamp": stamp.isoformat().replace("+00:00", "Z"),
        "expires_at": expires.isoformat().replace("+00:00", "Z"),
    }
    value["signature"] = sign(key, domain(
        "BB2D-L1/client-device",
        canonical({**value, "method": "POST", "path": "/v2/pairing/device"}),
    ))
    return value


def _response_data(server_key, response):
    verify(server_key.public_key(), response["signature"], domain(
        "BB2D-L1/server-device", canonical({
            "method": "POST", "path": "/v2/pairing/device", "status": 200,
            "response": {k: v for k, v in response.items() if k != "signature"},
        })))


def _http(server, method=b"POST", path=b"/v2/pairing/device", body=b"{}",
          headers=b"Content-Type: application/json\r\n"):
    with socket.create_connection(server.server_address, timeout=2) as sock:
        sock.sendall(method + b" " + path + b" HTTP/1.1\r\nHost: test\r\n" +
                     headers + b"Content-Length: " + str(len(body)).encode() +
                     b"\r\n\r\n" + body)
        sock.shutdown(socket.SHUT_WR)
        raw = sock.recv(20000)
    status = int(raw.split(b" ", 2)[1])
    return status, json.loads(raw.split(b"\r\n\r\n", 1)[1])


def _server_case(case, mutate=None):
    td, db, sk, ident, ds, cfg, service = _ctx(two=True)
    server = BoundedIPv4Server(("127.0.0.1", 0), service, cfg)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        _, key, real = ds[0]
        req = _request(key, real)
        if mutate:
            mutate(req, ds)
        status, out = _http(server, body=json.dumps(req, separators=(",", ":")).encode())
        assert status == 403 and out == {"error": "device_lifecycle_rejected"}, case
        forbidden = {"traceback", "exception", "public_key", "status", "signature", "device_id"}
        assert not forbidden.intersection(out)
    finally:
        server.shutdown(); thread.join(2); server.server_close(); td.cleanup()


def test_G017_VALID_STATUS():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        status, out = device_lifecycle(db, json.dumps(_request(key, real), separators=(",", ":")).encode(), ident, sk)
        assert status == 200 and out["status"] == "ACTIVE"
        _response_data(sk, out)
    finally:
        td.cleanup()


def test_G018_VALID_REVOKE():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        status, out = device_lifecycle(db, json.dumps(_request(key, real, "revoke"), separators=(",", ":")).encode(), ident, sk)
        assert status == 200 and out["status"] == "REVOKED"
        assert device_status(db, real)["status"] == "REVOKED"
    finally:
        td.cleanup()


def test_G019_EXACT_REVOKE_REPLAY():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        revoke_object = _request(key, real, "revoke", UUID_A)
        revoke_bytes = json.dumps(revoke_object, separators=(",", ":")).encode()
        before = sqlite3.connect(db).execute("select count(*) from pairing_audit_events where event_type='device_revoked'").fetchone()[0]
        first_status, first = device_lifecycle(db, revoke_bytes, ident, sk)
        second_status, second = device_lifecycle(db, revoke_bytes, ident, sk)
        after = sqlite3.connect(db).execute("select count(*) from pairing_audit_events where event_type='device_revoked'").fetchone()[0]
        assert revoke_bytes == revoke_bytes
        assert first_status == second_status == 200
        assert first["status"] == second["status"] == "REVOKED"
        assert device_status(db, real)["status"] == "REVOKED" and after - before == 1
    finally:
        td.cleanup()


def test_G020_FRESH_REVOKE_AFTER_REVOKED():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        first = json.dumps(_request(key, real, "revoke", UUID_A), separators=(",", ":")).encode()
        assert device_lifecycle(db, first, ident, sk)[0] == 200
        assert device_status(db, real)["status"] == "REVOKED"
        before = sqlite3.connect(db).execute("select count(*) from pairing_audit_events where event_type='device_revoked'").fetchone()[0]
        fresh = json.dumps(_request(key, real, "revoke", "00000000-0000-4000-8000-000000000003"), separators=(",", ":")).encode()
        status, out = device_lifecycle(db, fresh, ident, sk)
        after = sqlite3.connect(db).execute("select count(*) from pairing_audit_events where event_type='device_revoked'").fetchone()[0]
        assert status == 200 and out["status"] == "REVOKED" and after == before
    finally:
        td.cleanup()


def test_G021_STATUS_AFTER_REVOKE():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        device_lifecycle(db, json.dumps(_request(key, real, "revoke"), separators=(",", ":")).encode(), ident, sk)
        status, out = device_lifecycle(db, json.dumps(_request(key, real, "status", "00000000-0000-4000-8000-000000000003"), separators=(",", ":")).encode(), ident, sk)
        assert status == 200 and out["status"] == "REVOKED"
    finally:
        td.cleanup()


def test_G022_UNKNOWN_DEVICE_GENERIC():
    _server_case("unknown", lambda req, ds: req.update(device_id="00000000-0000-4000-8000-000000000099"))


def test_G023_WRONG_SIGNATURE_GENERIC():
    _server_case("wrong signature", lambda req, ds: req.update(signature=sign(ds[1][1], b"wrong")))


def test_G024_TAMPER_ACTION_GENERIC():
    _server_case("action", lambda req, ds: req.update(action="revoke"))


def test_G025_TAMPER_DEVICE_ID_GENERIC():
    _server_case("device", lambda req, ds: req.update(device_id=ds[1][2]))


def test_G026_TAMPER_REQUEST_ID_GENERIC():
    _server_case("request", lambda req, ds: req.update(request_id=UUID_B))


def test_G027_TAMPER_TIMESTAMP_GENERIC():
    _server_case("timestamp", lambda req, ds: req.update(timestamp=(datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=1)).isoformat().replace("+00:00", "Z")))


def test_G028_TAMPER_EXPIRES_GENERIC():
    _server_case("expires", lambda req, ds: req.update(expires_at=(datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=31)).isoformat().replace("+00:00", "Z")))


def _time_reject(stamp, expires):
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        req = _request(key, real, stamp=stamp, expires=expires)
        with patch("business_bridge_direct.pairing._lifecycle_now", return_value=T), pytest.raises(ValueError):
            device_lifecycle(db, json.dumps(req, separators=(",", ":")).encode(), ident, sk)
        assert device_status(db, real)["status"] == "ACTIVE"
    finally:
        td.cleanup()


def test_G029_EXPIRED_WITHIN_VALID_TIMESTAMP_SKEW(): _time_reject(T - timedelta(seconds=20), T - timedelta(seconds=10))
def test_G030_EXPIRES_EQUAL_NOW():
    timestamp, expires = T - timedelta(seconds=10), T
    assert timestamp < expires == T
    _time_reject(timestamp, expires)
def test_G031_EXPIRES_BEFORE_NOW(): _time_reject(T - timedelta(seconds=20), T - timedelta(seconds=10))
def test_G032_EXPIRES_EQUAL_TIMESTAMP(): _time_reject(T, T)
def test_G033_EXPIRES_BEFORE_TIMESTAMP(): _time_reject(T, T - timedelta(seconds=1))
def test_G034_TTL_OVER_60(): _time_reject(T, T + timedelta(seconds=61))
def test_G035_TIMESTAMP_TOO_OLD():
    timestamp, expires = T - timedelta(seconds=31), T + timedelta(seconds=20)
    assert timestamp < expires and expires > T and (expires - timestamp).total_seconds() == 51
    _time_reject(timestamp, expires)
def test_G036_TIMESTAMP_TOO_FUTURE():
    timestamp, expires = T + timedelta(seconds=31), T + timedelta(seconds=60)
    assert timestamp < expires and expires > T and (expires - timestamp).total_seconds() == 29
    _time_reject(timestamp, expires)


def _malformed(case):
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        req = _request(key, real)
        raw = json.dumps(req, separators=(",", ":")).encode()
        if case == "fractional": req["timestamp"] = "2026-01-01T00:00:00.1Z"
        elif case == "noncanonical": req["timestamp"] = "2026-01-01T00:00:00+00:00"
        elif case == "missing": del req["signature"]
        elif case == "unknown": req["unknown"] = "x"
        elif case == "wrong_type": req["action"] = 1
        elif case == "version": req["lifecycle_version"] = "bad"
        elif case == "action": req["action"] = "activate"
        elif case == "device": req["device_id"] = "not-a-uuid"
        elif case == "request": req["request_id"] = "not-a-uuid"
        elif case == "padded": req["signature"] += "="
        elif case == "alphabet": req["signature"] = "!" * len(req["signature"])
        elif case == "length": req["signature"] = b64u(b"x" * 63)
        raw = json.dumps(req, separators=(",", ":")).encode()
        if case == "duplicate": raw = raw[:-1] + b',"action":"status"}'
        with pytest.raises((ValueError, PermissionError)):
            device_lifecycle(db, raw, ident, sk)
    finally:
        td.cleanup()


def test_G037_FRACTIONAL_TIMESTAMP(): _malformed("fractional")
def test_G038_NONCANONICAL_UTC(): _malformed("noncanonical")
def test_G039_DUPLICATE_JSON(): _malformed("duplicate")
def test_G040_MISSING_FIELD(): _malformed("missing")
def test_G041_UNKNOWN_FIELD(): _malformed("unknown")
def test_G042_WRONG_TYPE(): _malformed("wrong_type")
def test_G043_INVALID_VERSION(): _malformed("version")
def test_G044_INVALID_ACTION(): _malformed("action")
def test_G045_INVALID_DEVICE_UUID(): _malformed("device")
def test_G046_INVALID_REQUEST_UUID(): _malformed("request")
def test_G047_PADDED_SIGNATURE(): _malformed("padded")
def test_G048_INVALID_SIGNATURE_ALPHABET(): _malformed("alphabet")
def test_G049_WRONG_SIGNATURE_LENGTH(): _malformed("length")


def test_G050_RESPONSE_ONE_CLOCK_DETERMINISTIC():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        with patch("business_bridge_direct.pairing._lifecycle_now", side_effect=[T, T + timedelta(seconds=1)]) as clock:
            status, out = device_lifecycle(db, json.dumps(_request(key, real, stamp=T), separators=(",", ":")).encode(), ident, sk)
        assert status == 200 and clock.call_count == 2
        _response_data(sk, out)
    finally: td.cleanup()


def test_G051_RESPONSE_TTL_60():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        with patch("business_bridge_direct.pairing._lifecycle_now", side_effect=[T, T]):
            _, out = device_lifecycle(db, json.dumps(_request(key, real, stamp=T), separators=(",", ":")).encode(), ident, sk)
        a = datetime.fromisoformat(out["timestamp"].replace("Z", "+00:00")); b = datetime.fromisoformat(out["expires_at"].replace("Z", "+00:00"))
        assert b - a == timedelta(seconds=60)
    finally: td.cleanup()


def test_G052_VALID_RESPONSE_SIGNATURE():
    test_G050_RESPONSE_ONE_CLOCK_DETERMINISTIC()


def _response_tamper(field):
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        _, out = device_lifecycle(db, json.dumps(_request(key, real), separators=(",", ":")).encode(), ident, sk)
        bad = dict(out); bad[field] = "tampered" if field not in {"timestamp", "expires_at"} else "2025-01-01T00:00:00Z"
        with pytest.raises((InvalidSignature, ValueError, TypeError)): _response_data(sk, bad)
    finally: td.cleanup()


def test_G053_RESPONSE_ACTION_TAMPER(): _response_tamper("action")
def test_G054_RESPONSE_DEVICE_TAMPER(): _response_tamper("device_id")
def test_G055_RESPONSE_INSTANCE_TAMPER(): _response_tamper("instance_id")
def test_G056_RESPONSE_FINGERPRINT_TAMPER(): _response_tamper("server_fingerprint")
def test_G057_RESPONSE_REQUEST_ID_TAMPER(): _response_tamper("request_id")
def test_G058_RESPONSE_STATUS_TAMPER(): _response_tamper("status")
def test_G059_RESPONSE_TIMESTAMP_TAMPER(): _response_tamper("timestamp")
def test_G060_RESPONSE_EXPIRES_TAMPER(): _response_tamper("expires_at")


def _response_signature_reject(kind):
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]
        _, out = device_lifecycle(db, json.dumps(_request(key, real), separators=(",", ":")).encode(), ident, sk)
        bad = dict(out)
        if kind == "missing": del bad["signature"]
        elif kind == "padded": bad["signature"] += "="
        else: bad["signature"] = sign(_key(), b"wrong")
        with pytest.raises((KeyError, InvalidSignature, ValueError, TypeError)): _response_data(sk, bad)
    finally: td.cleanup()


def test_G061_RESPONSE_MISSING_SIGNATURE(): _response_signature_reject("missing")
def test_G062_RESPONSE_PADDED_SIGNATURE(): _response_signature_reject("padded")
def test_G063_RESPONSE_WRONG_SIGNATURE(): _response_signature_reject("wrong")


def _http_matrix(case):
    td, db, sk, ident, ds, cfg, service = _ctx()
    server = BoundedIPv4Server(("127.0.0.1", 0), service, cfg); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        _, key, real = ds[0]; body = json.dumps(_request(key, real), separators=(",", ":")).encode()
        if case == "get": status, _ = _http(server, b"GET", body=body)
        elif case == "query": status, out = _http(server, path=b"/v2/pairing/device?x=1", body=body); assert out == {"error": "device_lifecycle_rejected"}
        elif case == "content": status, _ = _http(server, body=body, headers=b"Content-Type: text/plain\r\n")
        elif case == "chunked": status, _ = _http(server, body=body, headers=b"Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n")
        elif case == "oversized": status, _ = _http(server, body=b"x" * 5000)
        else:
            statuses = [_http(server, body=body)[0] for _ in range(12)]; status = 429 if 429 in statuses else statuses[-1]
        expected = {"get": 405, "query": 400, "content": 415, "chunked": 400, "oversized": 413, "rate": 429}[case]
        assert status == expected
    finally:
        server.shutdown(); thread.join(2); server.server_close(); td.cleanup()


def test_G064_GET_405(): _http_matrix("get")
def test_G065_QUERY_REJECTED(): _http_matrix("query")
def test_G066_WRONG_CONTENT_TYPE_415(): _http_matrix("content")
def test_G067_CHUNKED_REJECTED(): _http_matrix("chunked")
def test_G068_OVERSIZED_BOUNDED(): _http_matrix("oversized")
def test_G069_LIFECYCLE_RATE_LIMIT_BOUNDED(): _http_matrix("rate")


def test_G070_DEVICE_A_STATUS_A():
    td, db, sk, ident, ds, _, _ = _ctx(two=True)
    try:
        _, key, a = ds[0]; _, out = device_lifecycle(db, json.dumps(_request(key, a), separators=(",", ":")).encode(), ident, sk); assert out["device_id"] == a
    finally: td.cleanup()
def test_G071_DEVICE_B_STATUS_B():
    td, db, sk, ident, ds, _, _ = _ctx(two=True)
    try:
        _, key, b = ds[1]; _, out = device_lifecycle(db, json.dumps(_request(key, b, request_id=UUID_B), separators=(",", ":")).encode(), ident, sk); assert out["device_id"] == b
    finally: td.cleanup()
def test_G072_A_CANNOT_AUTH_AS_B():
    td, db, sk, ident, ds, _, _ = _ctx(two=True)
    try:
        _, ka, _ = ds[0]; _, _, b = ds[1]; req = _request(ka, b)
        with pytest.raises(PermissionError, match="device_lifecycle_rejected"): device_lifecycle(db, json.dumps(req, separators=(",", ":")).encode(), ident, sk)
    finally: td.cleanup()
def test_G073_A_CANNOT_REVOKE_B():
    td, db, sk, ident, ds, _, _ = _ctx(two=True)
    try:
        _, ka, _ = ds[0]; _, _, b = ds[1]; req = _request(ka, b, "revoke")
        with pytest.raises(PermissionError, match="device_lifecycle_rejected"): device_lifecycle(db, json.dumps(req, separators=(",", ":")).encode(), ident, sk)
        assert device_status(db, b)["status"] == "ACTIVE"
    finally: td.cleanup()
def test_G074_FAILED_A_TO_B_LEAVES_B_ACTIVE():
    td, db, sk, ident, ds, _, _ = _ctx(two=True)
    try:
        _, ka, _ = ds[0]; _, kb, b = ds[1]
        with pytest.raises(PermissionError): device_lifecycle(db, json.dumps(_request(ka, b), separators=(",", ":")).encode(), ident, sk)
        status, out = device_lifecycle(db, json.dumps(_request(kb, b, request_id=UUID_B), separators=(",", ":")).encode(), ident, sk)
        assert status == 200 and out["status"] == "ACTIVE" and device_status(db, b)["status"] == "ACTIVE"
    finally: td.cleanup()
def test_G075_B_SELF_REVOKE():
    td, db, sk, ident, ds, _, _ = _ctx(two=True)
    try:
        _, kb, b = ds[1]; status, out = device_lifecycle(db, json.dumps(_request(kb, b, "revoke", UUID_B), separators=(",", ":")).encode(), ident, sk); assert status == 200 and out["status"] == "REVOKED"
    finally: td.cleanup()
def test_G076_A_B_STATE_ISOLATION_TRANSITION():
    td, db, sk, ident, ds, _, _ = _ctx(two=True)
    try:
        _, ka, a = ds[0]; _, kb, b = ds[1]
        assert device_status(db, a)["status"] == device_status(db, b)["status"] == "ACTIVE"
        device_lifecycle(db, json.dumps(_request(ka, a, "revoke"), separators=(",", ":")).encode(), ident, sk)
        assert device_status(db, a)["status"] == "REVOKED"
        _, b_status = device_lifecycle(db, json.dumps(_request(kb, b, request_id=UUID_B), separators=(",", ":")).encode(), ident, sk)
        assert b_status["status"] == "ACTIVE"
        device_lifecycle(db, json.dumps(_request(kb, b, "revoke", "00000000-0000-4000-8000-000000000003"), separators=(",", ":")).encode(), ident, sk)
        assert device_status(db, b)["status"] == "REVOKED" and device_status(db, a)["status"] == "REVOKED"
    finally: td.cleanup()
def test_G077_ONLY_FIRST_REVOKE_TRANSITION():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]; before = sqlite3.connect(db).execute("select count(*) from pairing_audit_events where event_type='device_revoked'").fetchone()[0]
        for rid in (UUID_A, UUID_B): device_lifecycle(db, json.dumps(_request(key, real, "revoke", rid), separators=(",", ":")).encode(), ident, sk)
        after = sqlite3.connect(db).execute("select count(*) from pairing_audit_events where event_type='device_revoked'").fetchone()[0]; assert after - before == 1
    finally: td.cleanup()
def test_G078_NO_REACTIVATION():
    td, db, sk, ident, ds, _, _ = _ctx()
    try:
        _, key, real = ds[0]; device_lifecycle(db, json.dumps(_request(key, real, "revoke"), separators=(",", ":")).encode(), ident, sk); assert device_status(db, real)["status"] == "REVOKED"
        status, out = device_lifecycle(db, json.dumps(_request(key, real, "status", UUID_B), separators=(",", ":")).encode(), ident, sk); assert status == 200 and out["status"] == "REVOKED"
        assert device_status(db, real)["status"] == "REVOKED"
    finally: td.cleanup()


def test_G079_ONE_TIME_PAIRING_REGRESSION():
    td, db, *_ = _ctx();
    try:
        sid, code, _ = create_session(db); key = _key(); assert complete_pairing(db, sid, code, _spki(key))[0]; assert not complete_pairing(db, sid, code, _spki(key))[0]
    finally: td.cleanup()
def test_G080_SESSION_REGRESSION():
    td, db, *_ = _ctx();
    try: assert create_session(db)[0]
    finally: td.cleanup()
def test_G081_PROTOCOL_REGRESSION():
    from business_bridge_direct.protocol import domain as protocol_domain
    assert protocol_domain("BB2D-P1", b"probe")
def test_G082_PROTECTED_TASKS_REGRESSION():
    import business_bridge_direct.tasks
def test_G083_DURABLE_JOBS_REGRESSION():
    import business_bridge_direct.worker
def test_G084_RECOVERY_REGRESSION():
    assert initialize_database
def test_G085_BB2D1_BUNDLE_REGRESSION():
    import business_bridge_direct.bundle
