"""Endpoint-specific server acceptance clients for BB2D-P1.

The scenario layer only composes these clients; it never builds wire data.
"""
from __future__ import annotations

import base64, hashlib, json, secrets, socket, uuid
from datetime import datetime, timedelta, timezone
from typing import Callable
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from business_bridge_direct.protocol import ENV_FIELDS, PV, SESSION_FIELDS, domain, ts
from business_bridge_direct.protocol_crypto import aes_decrypt, aes_encrypt, b64u, canonical, hkdf, length_info, sign, unb64, verify

PREAUTH_ERROR_VALUES = {
    "malformed_request", "unsupported_protocol_version", "unknown_device", "device_revoked",
    "invalid_signature", "wrong_curve", "expired_message", "invalid_timestamp", "unknown_session",
    "rekey_required", "sequence_violation", "replay_detected", "nonce_reuse", "authentication_failed",
    "invalid_plaintext",
}


def _uuid() -> str: return str(uuid.uuid4())
def _utc(offset: int = 0) -> str:
    return (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=offset)).isoformat().replace("+00:00", "Z")


def _parse(raw: bytes) -> dict:
    def hook(items):
        value = dict(items)
        if len(items) != len(value): raise ValueError("duplicate_json_key")
        return value
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=hook)
    if not isinstance(value, dict): raise ValueError("invalid_json_object")
    return value


def _read(sock: socket.socket) -> tuple[int, bytes, dict[str, str]]:
    data = bytearray()
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk: raise ValueError("truncated_http_headers")
        data.extend(chunk)
    head, body = bytes(data).split(b"\r\n\r\n", 1); lines = head.split(b"\r\n")
    headers = {k.decode("ascii").lower(): v.strip().decode("latin1") for k, v in (line.split(b":", 1) for line in lines[1:])}
    length = int(headers["content-length"])
    while len(body) < length:
        chunk = sock.recv(4096)
        if not chunk: raise ValueError("truncated_http_body")
        body += chunk
    return int(lines[0].split(b" ", 2)[1]), body[:length], headers


class HTTPTransport:
    """Only generic HTTP transport. It knows no protocol payload or envelope."""
    def __init__(self, host: str, port: int, handler: Callable | None = None): self.host, self.port, self.handler = host, port, handler
    def send(self, method: str, path: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes, dict[str, str]]:
        if self.handler: return self.handler(method, path, headers, body)
        request = f"{method} {path} HTTP/1.1\r\nHost: acceptance\r\n".encode() + b"".join(f"{k}: {v}\r\n".encode() for k,v in headers.items()) + f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body
        with socket.create_connection((self.host, self.port), timeout=5) as sock: sock.sendall(request); return _read(sock)


class PairingClient:
    PATH = "/v2/pairing/complete"
    def __init__(self, transport: HTTPTransport, device_public_key: bytes): self.transport, self.device_public_key = transport, device_public_key
    def complete(self, pairing_session_id: str, pairing_code: str) -> dict:
        body = canonical({"pairing_version":"1", "pairing_session_id":pairing_session_id, "pairing_code":pairing_code, "device_public_key":b64u(self.device_public_key), "device_public_key_format":"SPKI_DER_BASE64URL"})
        status, raw, headers = self.transport.send("POST", self.PATH, {"Content-Type":"application/json"}, body)
        if status != 201 or headers.get("content-type", "").lower() not in {"application/json", "application/json; charset=utf-8"}: raise ValueError("pairing_response")
        result = _parse(raw)
        if set(result) != {"pairing_version", "device_id", "device_fingerprint", "status", "paired_at", "instance_id"}: raise ValueError("pairing_response_fields")
        return result


class SessionClient:
    PATH = "/v2/protocol/session"
    def __init__(self, transport: HTTPTransport, device_id: str, device_key, server_key=None):
        self.transport, self.device_id, self.device_key, self.server_key = transport, device_id, device_key, server_key
        self.ephemeral_key = ec.generate_private_key(ec.SECP256R1()); self.ephemeral_der = self.ephemeral_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    def open(self) -> dict:
        self.request_id, self.client_nonce = _uuid(), secrets.token_bytes(32)
        fields = {"protocol_version":PV,"device_id":self.device_id,"client_ephemeral_public_key":b64u(self.ephemeral_der),"client_nonce":b64u(self.client_nonce),"request_id":self.request_id,"timestamp":_utc(),"expires_at":_utc(30)}
        fields["signature"] = sign(self.device_key, domain("BB2D-P1/client-session", canonical({k: fields[k] for k in SESSION_FIELDS if k != "signature"})))
        status, raw, _ = self.transport.send("POST", self.PATH, {"Content-Type":"application/json"}, canonical(fields))
        if status != 200: raise ValueError("session_response")
        response = _parse(raw)
        if set(response) != {"protocol_version","session_id","instance_id","server_fingerprint","server_ephemeral_public_key","server_nonce","request_id","timestamp","expires_at","signature"}: raise ValueError("session_response_fields")
        if response["request_id"] != self.request_id: raise ValueError("session_binding")
        if self.server_key: verify(self.server_key, response["signature"], domain("BB2D-P1/server-session", canonical({"client_request_sha256":hashlib.sha256(canonical({k: fields[k] for k in SESSION_FIELDS if k != "signature"})).hexdigest(), "response":{k:response[k] for k in response if k != "signature"}})))
        server_der = unb64(response["server_ephemeral_public_key"]); shared = self.ephemeral_key.exchange(ec.ECDH(), serialization.load_der_public_key(server_der)); info = length_info([PV, response["instance_id"], response["server_fingerprint"], self.device_id, response["session_id"], hashlib.sha256(self.ephemeral_der).hexdigest(), hashlib.sha256(server_der).hexdigest(), self.request_id]); keys = hkdf(shared, hashlib.sha256(self.client_nonce + unb64(response["server_nonce"], 32)).digest(), info)
        self.session_id, self.c2s, self.s2c = response["session_id"], keys[:32], keys[32:]
        return {"session_id": self.session_id, "device_id": self.device_id}


class TaskClient:
    PATH = "/v2/protocol/tasks"
    def __init__(self, transport: HTTPTransport, device_id: str, device_key, session: SessionClient, server_key=None): self.transport,self.device_id,self.device_key,self.session,self.server_key=transport,device_id,device_key,session,server_key; self.sequence=0
    def create(self, operation_id=None, payload=None, pending=False): return {"type":"task_create","operation_id":operation_id or _uuid(),"task_payload":payload if payload is not None else {"a":["safe"],"b":1},"execution_mode":"remain_pending" if pending else "complete_immediately"}
    def status(self, task_id): return {"type":"task_status","task_id":task_id}
    def cancel(self, task_id): return {"type":"task_cancel","task_id":task_id}
    def report(self, task_id): return {"type":"task_report","task_id":task_id}
    def send(self, application: dict, sequence: int | None = None, mutation: str | None = None) -> tuple[int, dict]:
        if set(application) - {"type","operation_id","task_payload","execution_mode","task_id"}: raise ValueError("invalid_application")
        seq = self.sequence + 1 if sequence is None else sequence; request_id = _uuid(); nonce = secrets.token_bytes(12); stamp, expiry = _utc(), _utc(30); sid = self.session.session_id
        aad = canonical({"direction":"client-to-server","method":"POST","path":self.PATH,"protocol_version":PV,"session_id":sid,"device_id":self.device_id,"request_id":request_id,"sequence":seq,"timestamp":stamp,"expires_at":expiry,"nonce":b64u(nonce)})
        ciphertext = aes_encrypt(self.session.c2s, nonce, canonical(application), aad); envelope={"protocol_version":PV,"session_id":sid,"device_id":self.device_id,"request_id":request_id,"sequence":seq,"timestamp":stamp,"expires_at":expiry,"nonce":b64u(nonce),"ciphertext":b64u(ciphertext)}; envelope["signature"] = sign(self.device_key, domain("BB2D-P1/client-tasks", aad+b"\0"+nonce+b"\0"+ciphertext))
        if mutation == "extra_field": envelope["extra"] = True
        raw = canonical(envelope); status, response_raw, _ = self.transport.send("POST", self.PATH, {"Content-Type":"application/json"}, raw)
        response = _parse(response_raw)
        if set(response) != ENV_FIELDS:
            if set(response) != {"error"} or response["error"] not in PREAUTH_ERROR_VALUES:
                raise ValueError("generic_error_fields")
            return status, response
        rn, ct = unb64(response["nonce"],12), unb64(response["ciphertext"]); ra = canonical({"direction":"server-to-client","method":"POST","path":self.PATH,"status":status,"protocol_version":PV,"session_id":sid,"device_id":self.device_id,"request_id":request_id,"sequence":seq,"timestamp":response["timestamp"],"expires_at":response["expires_at"],"nonce":response["nonce"]}); result = _parse(aes_decrypt(self.session.s2c, rn, ct, ra))
        if self.server_key:
            unsigned = {key: value for key, value in response.items() if key != "signature"}
            verify(self.server_key, response["signature"], domain("BB2D-P1/server-tasks", canonical({"aad": ra.decode(), "envelope": unsigned})))
        self.sequence=max(self.sequence,seq); return status,result


class TaskAcceptanceScenario:
    """Orchestration only: endpoint clients own all request construction."""
    def __init__(self, pairing: PairingClient, session: SessionClient, tasks: TaskClient): self.pairing,self.session,self.tasks=pairing,session,tasks
    def happy_path(self, pairing_session_id: str, pairing_code: str) -> dict:
        paired = self.pairing.complete(pairing_session_id, pairing_code); opened = self.session.open(); created = self.tasks.send(self.tasks.create()); return {"paired": paired, "session": opened, "create": created}
    def negative_path(self, task_id: str) -> dict: return {"status": self.tasks.send(self.tasks.status(task_id)), "report": self.tasks.send(self.tasks.report(task_id))}
