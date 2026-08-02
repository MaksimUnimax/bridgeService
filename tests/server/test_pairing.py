from __future__ import annotations
import base64, json, os, pathlib, pwd, socket, subprocess, tempfile, threading, unittest
from types import SimpleNamespace
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from business_bridge_direct.database import create_session, initialize_database, session_status, revoke_device, revoke_session
from business_bridge_direct.database import complete_pairing, device_status
from business_bridge_direct.pairing import device_lifecycle, parse_request
from business_bridge_direct.http_api import BoundedIPv4Server
from business_bridge_direct.protocol import domain
from business_bridge_direct.protocol_crypto import b64u, canonical, sign, verify

class PairingTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(); self.db = str(pathlib.Path(self.t.name)/"pair.sqlite3"); initialize_database(self.db)
    def tearDown(self): self.t.cleanup()
    def key(self):
        p=pathlib.Path(self.t.name)/"device.pem"; p.write_bytes(subprocess.check_output(["/usr/bin/openssl","ecparam","-name","prime256v1","-genkey","-noout"]))
        der=subprocess.check_output(["/usr/bin/openssl","pkey","-in",str(p),"-pubout","-outform","DER"]); return base64.urlsafe_b64encode(der).decode().rstrip("=")
    def body(self,sid,code,key=None):
        return json.dumps({"pairing_version":"1","pairing_session_id":sid,"pairing_code":code,"device_public_key":key or self.key(),"device_public_key_format":"SPKI_DER_BASE64URL"},separators=(",",":")).encode()
    def test_fresh_schema_and_idempotent_initialize(self):
        initialize_database(self.db); import sqlite3
        with sqlite3.connect(self.db) as c: self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0],5)
    def test_code_is_not_plaintext_and_salts_differ(self):
        a,ca,_=create_session(self.db); b,cb,_=create_session(self.db); import sqlite3
        with sqlite3.connect(self.db) as c:
            rows=c.execute("SELECT code_salt,code_verifier FROM pairing_sessions").fetchall(); raw=c.iterdump().__next__()
        self.assertNotEqual(rows[0][0],rows[1][0]); self.assertNotIn(ca,raw); self.assertNotEqual(rows[0][1],ca.encode()); self.assertNotEqual(a,b); self.assertEqual(len(ca),32)
    def test_ttl_bounds(self):
        with self.assertRaises(ValueError): create_session(self.db,299)
        with self.assertRaises(ValueError): create_session(self.db,601)
        self.assertTrue(create_session(self.db,600)[2])
    def test_strict_json_and_key_validation(self):
        sid,code,_=create_session(self.db); key=self.key(); self.assertEqual(parse_request(self.body(sid,code,key))["pairing_version"],"1")
        with self.assertRaises(ValueError): parse_request(self.body(sid,code,key)[:-1]+b",\"x\":1}")
        with self.assertRaises(ValueError): parse_request(self.body(sid,code,key).replace(b'"pairing_version":"1"',b'"pairing_version":"1","pairing_version":"1"'))
    def test_valid_code_is_single_use_and_private_key_not_in_db(self):
        sid,code,_=create_session(self.db); key=self.key(); from business_bridge_direct.database import complete_pairing
        ok,result=complete_pairing(self.db,sid,code,key); self.assertTrue(ok); self.assertFalse(complete_pairing(self.db,sid,code,key)[0]); self.assertEqual(session_status(self.db,sid)["status"],"CONSUMED"); self.assertNotIn("private", result)
    def test_wrong_code_locks_on_fifth_attempt_and_revoke_is_idempotent(self):
        sid,code,_=create_session(self.db); from business_bridge_direct.database import complete_pairing
        for _ in range(5): self.assertFalse(complete_pairing(self.db,sid,"0"*32,self.key())[0])
        self.assertEqual(session_status(self.db,sid)["status"],"LOCKED"); self.assertFalse(complete_pairing(self.db,sid,code,self.key())[0]); self.assertEqual(revoke_session(self.db,sid)[0],"already_final")
        sid2,code2,_=create_session(self.db); ok,d=complete_pairing(self.db,sid2,code2,self.key()); self.assertTrue(ok); self.assertEqual(revoke_device(self.db,d["device_id"])[0],"revoked"); self.assertEqual(revoke_device(self.db,d["device_id"])[0],"already_revoked")

    def test_expiry_is_persistent_and_rejects_after_restart(self):
        sid, code, _ = create_session(self.db, now="2026-01-01T00:00:00Z")
        from business_bridge_direct.database import complete_pairing
        self.assertFalse(complete_pairing(self.db, sid, code, self.key(), now="2026-01-01T00:10:01Z")[0])
        self.assertEqual(session_status(self.db, sid)["status"], "EXPIRED")
        initialize_database(self.db)
        self.assertFalse(complete_pairing(self.db, sid, code, self.key(), now="2026-01-01T00:05:02Z")[0])

    def test_production_shaped_startup_migrates_with_service_permissions(self):
        service_user = pwd.getpwnam("business-bridge-direct")
        root = pathlib.Path(self.t.name) / "runtime"
        root.mkdir(mode=0o750)
        db = root / "bridge.sqlite3"
        import sqlite3
        with sqlite3.connect(db) as c:
            c.execute("CREATE TABLE runtime_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            c.execute("INSERT INTO runtime_metadata VALUES ('schema_version','1')")
            c.execute("INSERT INTO runtime_metadata VALUES ('service_version','0.4.0')")
            c.execute("PRAGMA user_version=1")
        os.chown(root, service_user.pw_uid, service_user.pw_gid)
        os.chown(db, service_user.pw_uid, service_user.pw_gid)
        os.chmod(root, 0o750); os.chmod(db, 0o600)
        os.chmod(self.t.name, 0o755)
        probe = pathlib.Path(self.t.name) / "startup_probe.py"
        probe.write_text("from business_bridge_direct.database import initialize_database, check_database\ninitialize_database(__import__('sys').argv[1])\nassert check_database(__import__('sys').argv[1])\n")
        os.chown(probe, service_user.pw_uid, service_user.pw_gid); os.chmod(probe, 0o640)
        wheel = os.environ.get("BB2_WHEEL_UNDER_TEST")
        self.assertIsNotNone(wheel, "installed-wheel regression requires BB2_WHEEL_UNDER_TEST")
        os.chmod(pathlib.Path(wheel).parent, 0o755)
        os.chmod(pathlib.Path(wheel).parent.parent, 0o755)
        os.chmod(wheel, 0o644)
        code = "import sys; sys.path.insert(0, sys.argv[1]); sys.argv=sys.argv[2:]; exec(open(sys.argv[0]).read(), {'__name__':'__main__'})"
        result = subprocess.run(["runuser", "-u", "business-bridge-direct", "--", "python3", "-c", code, wheel, str(probe), str(db)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with sqlite3.connect(db) as c: self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0], 5)

    def test_http_pairing_contract_is_single_use_and_get_is_safe(self):
        key = self.key(); sid, code, _ = create_session(self.db)
        identity = {"instance_id":"00000000-0000-4000-8000-000000000000"}
        service = SimpleNamespace(database_path=self.db, service_name="business-bridge-2-direct", version="0.6.0", identity=identity)
        cfg = SimpleNamespace(request_timeout_seconds=5, max_header_bytes=8192, max_request_line_bytes=2048, max_request_body_bytes=4096, max_header_count=32, max_concurrent_requests=16, listen_backlog=4, per_source_rate_window_seconds=10, per_source_rate_limit=30, global_rate_window_seconds=10, global_rate_limit=120)
        server = BoundedIPv4Server(("127.0.0.1", 0), service, cfg); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(method, path, body=b""):
            with socket.create_connection(server.server_address, timeout=2) as s:
                request = method + b" " + path + b" HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
                s.sendall(request); return s.recv(8192)
        body = self.body(sid, code, key)
        try:
            self.assertIn(b"HTTP/1.1 405", request(b"GET", b"/v2/pairing/complete")); self.assertNotIn(code.encode(), request(b"GET", b"/v2/pairing/complete"))
            self.assertIn(b"HTTP/1.1 201", request(b"POST", b"/v2/pairing/complete", body))
            self.assertIn(b"HTTP/1.1 403", request(b"POST", b"/v2/pairing/complete", body))
        finally:
            server.shutdown(); thread.join(2); server.server_close()


class DeviceLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(); root = pathlib.Path(self.t.name)
        self.db = str(root / "pair.sqlite3"); initialize_database(self.db)
        self.device = ec.generate_private_key(ec.SECP256R1())
        der = self.device.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.device_spki = b64u(der)
        self.server_key = ec.generate_private_key(ec.SECP256R1())
        server_der = self.server_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        key_path = root / "server.pem"; key_path.write_bytes(self.server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        self.identity = {"instance_id":"00000000-0000-4000-8000-000000000000", "fingerprint":"sha256:" + __import__("hashlib").sha256(server_der).hexdigest()}
        self.cfg = SimpleNamespace(request_timeout_seconds=5, max_header_bytes=8192, max_request_line_bytes=2048, max_request_body_bytes=4096, max_header_count=32, max_concurrent_requests=16, listen_backlog=4, per_source_rate_window_seconds=10, per_source_rate_limit=30, global_rate_window_seconds=10, global_rate_limit=120, server_signing_private_key_path=str(key_path))
        sid, code, _ = create_session(self.db); ok, result = complete_pairing(self.db, sid, code, self.device_spki); self.assertTrue(ok); self.device_id = result["device_id"]
        self.service = SimpleNamespace(database_path=self.db, service_name="business-bridge-2-direct", version="0.9.1", identity=self.identity, config=self.cfg)
        self.server = BoundedIPv4Server(("127.0.0.1", 0), self.service, self.cfg); self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.thread.join(2); self.server.server_close(); self.t.cleanup()

    def request(self, value):
        body = json.dumps(value, separators=(",", ":")).encode()
        with socket.create_connection(self.server.server_address, timeout=2) as sock:
            sock.sendall(b"POST /v2/pairing/device HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body); sock.shutdown(socket.SHUT_WR); raw = sock.recv(20000)
        return int(raw.split(b" ", 2)[1]), json.loads(raw.split(b"\r\n\r\n", 1)[1])

    def signed(self, action, request_id="00000000-0000-4000-8000-000000000001", device_id=None, stamp=None, expires=None):
        stamp = stamp or datetime.now(timezone.utc).replace(microsecond=0); ts = stamp.isoformat().replace("+00:00", "Z"); exp = (expires or (stamp + timedelta(seconds=30))).isoformat().replace("+00:00", "Z")
        value = {"lifecycle_version":"BB2D-L1", "action":action, "device_id":device_id or self.device_id, "request_id":request_id, "timestamp":ts, "expires_at":exp}
        value["signature"] = sign(self.device, domain("BB2D-L1/client-device", canonical({**value, "method":"POST", "path":"/v2/pairing/device"})))
        return value

    def test_expired_within_timestamp_skew_is_rejected_without_mutation(self):
        server_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        request = self.signed("status", stamp=server_now - timedelta(seconds=20), expires=server_now - timedelta(seconds=10))
        before = device_status(self.db, self.device_id)["status"]
        with patch("business_bridge_direct.pairing._lifecycle_now", return_value=server_now):
            with self.assertRaises(ValueError):
                device_lifecycle(self.db, json.dumps(request, separators=(",", ":")).encode(), self.identity, self.server_key)
        self.assertEqual(before, "ACTIVE")
        self.assertEqual(device_status(self.db, self.device_id)["status"], "ACTIVE")

    def test_response_timestamp_and_expiry_use_one_clock_sample(self):
        server_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        response_now = server_now + timedelta(seconds=1)
        request = self.signed("status", stamp=server_now)
        with patch("business_bridge_direct.pairing._lifecycle_now", side_effect=[server_now, response_now]) as clock:
            status, response = device_lifecycle(self.db, json.dumps(request, separators=(",", ":")).encode(), self.identity, self.server_key)
        self.assertEqual(status, 200)
        self.assertEqual(clock.call_count, 2)
        timestamp = datetime.fromisoformat(response["timestamp"].replace("Z", "+00:00"))
        expires = datetime.fromisoformat(response["expires_at"].replace("Z", "+00:00"))
        self.assertEqual(expires - timestamp, timedelta(seconds=60))
        verify(self.server_key.public_key(), response["signature"], domain("BB2D-L1/server-device", canonical({"method":"POST", "path":"/v2/pairing/device", "status":200, "response":{k:v for k,v in response.items() if k != "signature"}})))

    def test_status_revoke_replay_and_status_after_revoke(self):
        status, body = self.request(self.signed("status")); self.assertEqual(status, 200); self.assertEqual(body["status"], "ACTIVE")
        server_der = self.server_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        verify(serialization.load_der_public_key(server_der), body["signature"], domain("BB2D-L1/server-device", canonical({"method":"POST", "path":"/v2/pairing/device", "status":200, "response":{k:v for k,v in body.items() if k != "signature"}})))
        revoke = self.signed("revoke", "00000000-0000-4000-8000-000000000002")
        status, body = self.request(revoke); self.assertEqual((status, body["status"]), (200, "REVOKED")); self.assertEqual(device_status(self.db, self.device_id)["status"], "REVOKED")
        status, replay = self.request(revoke); self.assertEqual((status, replay["status"]), (200, "REVOKED")); self.assertEqual(device_status(self.db, self.device_id)["status"], "REVOKED")
        status, body = self.request(self.signed("status", "00000000-0000-4000-8000-000000000003")); self.assertEqual((status, body["status"]), (200, "REVOKED"))

    def test_unknown_tamper_and_method_are_generic(self):
        unknown = self.signed("status", device_id="00000000-0000-4000-8000-000000000099")
        status, body = self.request(unknown); self.assertEqual(status, 403); self.assertEqual(body, {"error":"device_lifecycle_rejected"})
        bad = self.signed("status"); bad["action"] = "revoke"; status, body = self.request(bad); self.assertEqual(status, 403); self.assertEqual(body, {"error":"device_lifecycle_rejected"})
        with socket.create_connection(self.server.server_address, timeout=2) as sock:
            sock.sendall(b"GET /v2/pairing/device HTTP/1.1\r\nHost: test\r\n\r\n"); self.assertIn(b"HTTP/1.1 405", sock.recv(4096))
