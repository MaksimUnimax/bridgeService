"""Canonical BB2D-P1 acceptance client used by every transport adapter."""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from business_bridge_direct.protocol import ENV_FIELDS, PV, domain, ts
from business_bridge_direct.protocol_crypto import (
    aes_decrypt, aes_encrypt, b64u, canonical, hkdf, length_info, sign, unb64, verify,
)

TASK_TYPES = {"task_create", "task_status", "task_cancel", "task_report"}
RESPONSE_FIELDS = ENV_FIELDS
PREAUTH_ERROR_VALUES = {
    "malformed_request", "unsupported_protocol_version", "unknown_device", "device_revoked",
    "invalid_signature", "wrong_curve", "expired_message", "invalid_timestamp", "unknown_session",
    "rekey_required", "sequence_violation", "replay_detected", "nonce_reuse", "authentication_failed",
    "invalid_plaintext",
}
MUTATORS = {
    "extra_outer_field", "missing_outer_field", "malformed_base64url", "wrong_signature",
    "modified_ciphertext", "stale_timestamp", "future_timestamp_outside_window",
    "reused_request_id", "reused_nonce", "sequence_regression", "sequence_gap",
    "invalid_application_field", "operation_payload_conflict", "unknown_task",
    "not_cancellable_task", "report_unavailable",
}


def _uuid() -> str:
    return str(uuid.uuid4())


def _utc(offset: int = 0) -> str:
    value = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=offset)
    return value.isoformat().replace("+00:00", "Z")


def _parse(data: bytes) -> dict:
    pairs: list[tuple[str, object]] = []

    def hook(items):
        pairs.extend(items)
        return dict(items)

    value = json.loads(data.decode("utf-8"), object_pairs_hook=hook, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")))
    if not isinstance(value, dict) or len({key for key, _ in pairs}) != len(pairs):
        raise ValueError("duplicate_json_key")
    return value


def _read_response(sock: socket.socket) -> tuple[int, bytes, dict[str, str]]:
    data = bytearray()
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            raise ValueError("truncated_http_headers")
        data.extend(chunk)
    head, body = bytes(data).split(b"\r\n\r\n", 1)
    lines = head.split(b"\r\n")
    status = int(lines[0].split(b" ", 2)[1])
    headers: dict[str, str] = {}
    for line in lines[1:]:
        key, value = line.split(b":", 1)
        headers[key.decode("ascii").lower()] = value.strip().decode("latin1")
    length = int(headers["content-length"])
    while len(body) < length:
        chunk = sock.recv(4096)
        if not chunk:
            raise ValueError("truncated_http_body")
        body += chunk
    return status, body[:length], headers


class SocketTransport:
    """The only HTTP wire adapter; it never creates or changes an envelope."""

    def __init__(self, host: str, port: int):
        self.host, self.port = host, port

    def send(self, method: str, target: str, body: bytes) -> tuple[int, bytes, dict[str, str]]:
        if method != "POST" or target != "/v2/protocol/tasks":
            raise ValueError("transport_boundary")
        request = (b"POST /v2/protocol/tasks HTTP/1.1\r\nHost: acceptance\r\n"
                   b"Content-Type: application/json\r\nContent-Length: " + str(len(body)).encode("ascii") +
                   b"\r\nConnection: close\r\n\r\n" + body)
        with socket.create_connection((self.host, self.port), timeout=5) as sock:
            sock.sendall(request)
            return _read_response(sock)


class CallableTransport:
    """Adapter for an in-process protocol handler."""

    def __init__(self, handler: Callable[[bytes], tuple[int, dict]]):
        self.handler = handler

    def send(self, method: str, target: str, body: bytes) -> tuple[int, bytes, dict[str, str]]:
        if method != "POST" or target != "/v2/protocol/tasks":
            raise ValueError("transport_boundary")
        status, response = self.handler(body)
        raw = canonical(response)
        return status, raw, {"content-type": "application/json", "content-length": str(len(raw))}


class AcceptanceClient:
    """One client implementation shared by in-process, source, wheel and production TCP."""

    def __init__(self, transport):
        self.transport = transport
        self.device_id = _uuid()
        self.device_key = ec.generate_private_key(ec.SECP256R1())
        self.device_der = self.device_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.ephemeral_key = ec.generate_private_key(ec.SECP256R1())
        self.ephemeral_der = self.ephemeral_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.session_id: str | None = None
        self.c2s: bytes | None = None
        self.s2c: bytes | None = None
        self.server_key = None
        self.sequence = 0
        self._request_ids: set[str] = set()
        self._nonces: set[str] = set()
        self.last_envelope: dict | None = None

    def pairing_body(self, pairing_session_id: str, pairing_code: str) -> bytes:
        return canonical({"pairing_version": "1", "pairing_session_id": pairing_session_id, "pairing_code": pairing_code, "device_public_key": b64u(self.device_der), "device_public_key_format": "SPKI_DER_BASE64URL"})

    def session_body(self) -> bytes:
        self.session_request_id = _uuid(); self.client_nonce = secrets.token_bytes(32)
        query = {"protocol_version": PV, "device_id": self.device_id, "client_ephemeral_public_key": b64u(self.ephemeral_der), "client_nonce": b64u(self.client_nonce), "request_id": self.session_request_id, "timestamp": _utc(), "expires_at": _utc(30)}
        query["signature"] = sign(self.device_key, domain("BB2D-P1/client-session", canonical(query)))
        return canonical(query)

    def open_session(self, response: dict, server_key=None) -> None:
        self.session_id = response["session_id"]
        server_der = unb64(response["server_ephemeral_public_key"])
        server_nonce = unb64(response["server_nonce"], 32)
        server_ephemeral = serialization.load_der_public_key(server_der)
        info = length_info([PV, response["instance_id"], response["server_fingerprint"], self.device_id, self.session_id, hashlib.sha256(self.ephemeral_der).hexdigest(), hashlib.sha256(server_der).hexdigest(), self.session_request_id])
        shared = self.ephemeral_key.exchange(ec.ECDH(), server_ephemeral)
        out = hkdf(shared, hashlib.sha256(self.client_nonce + server_nonce).digest(), info)
        self.c2s, self.s2c, self.server_key = out[:32], out[32:], server_key

    def _application(self, kind: str, task_id: str | None = None, operation_id: str | None = None, payload=None, mode: str = "complete_immediately") -> dict:
        if kind == "task_create":
            return {"type": kind, "operation_id": operation_id or _uuid(), "task_payload": payload if payload is not None else {"a": ["safe"], "b": 1}, "execution_mode": mode}
        return {"type": kind, "task_id": task_id or _uuid()}

    def task_create_immediate(self, operation_id=None, payload=None) -> dict: return self._application("task_create", operation_id=operation_id, payload=payload)
    def task_create_pending(self, operation_id=None, payload=None) -> dict: return self._application("task_create", operation_id=operation_id, payload=payload, mode="remain_pending")
    def equivalent_duplicate_create(self, operation_id, payload=None) -> dict: return self.task_create_immediate(operation_id, {"b": 1, "a": ["safe"]} if payload is None else payload)
    def reordered_payload_duplicate_create(self, operation_id) -> dict: return self.task_create_immediate(operation_id, {"b": 1, "a": ["safe"]})
    def different_payload_conflict_create(self, operation_id) -> dict: return self.task_create_immediate(operation_id, {"different": True})
    def task_status(self, task_id): return self._application("task_status", task_id)
    def task_cancel(self, task_id): return self._application("task_cancel", task_id)
    def repeated_cancel(self, task_id): return self.task_cancel(task_id)
    def task_report(self, task_id): return self._application("task_report", task_id)
    def repeated_report(self, task_id): return self.task_report(task_id)
    def unknown_task_status(self): return self.task_status(_uuid())
    def unknown_task_report(self): return self.task_report(_uuid())
    def authenticated_invalid_application_request(self): return {"type": "invalid_task"}

    def _validate_request(self, raw: bytes, *, method="POST", target="/v2/protocol/tasks") -> dict:
        if method != "POST" or target != "/v2/protocol/tasks" or not isinstance(raw, bytes): raise ValueError("request_boundary")
        envelope = _parse(raw)
        if set(envelope) != ENV_FIELDS: raise ValueError("unknown_or_missing_field")
        if envelope["protocol_version"] != PV: raise ValueError("unsupported_protocol_version")
        for field in ("session_id", "device_id", "request_id"):
            value = envelope[field]
            if not isinstance(value, str) or str(uuid.UUID(value)) != value or uuid.UUID(value).version != 4 or value != value.lower(): raise ValueError("malformed_uuid")
        if type(envelope["sequence"]) is not int or envelope["sequence"] < 1: raise ValueError("malformed_sequence")
        timestamp = ts(envelope["timestamp"]); expiry = ts(envelope["expires_at"])
        if expiry <= timestamp: raise ValueError("invalid_expiry")
        if abs((datetime.now(timezone.utc).replace(microsecond=0) - timestamp).total_seconds()) > 30: raise ValueError("invalid_timestamp")
        nonce = unb64(envelope["nonce"], 12); unb64(envelope["ciphertext"]); unb64(envelope["signature"], 64)
        if envelope["session_id"] != self.session_id or envelope["device_id"] != self.device_id: raise ValueError("binding_mismatch")
        if len(raw) != len(raw.decode("utf-8").encode("utf-8")): raise ValueError("invalid_utf8")
        self._nonces.add(b64u(nonce)); self._request_ids.add(envelope["request_id"])
        return envelope

    def _build(self, application: dict, *, mutation: str | None = None, sequence: int | None = None) -> bytes:
        if self.c2s is None or self.session_id is None: raise ValueError("session_not_open")
        seq = self.sequence + 1 if sequence is None else sequence
        request_id = _uuid(); nonce = secrets.token_bytes(12); timestamp = _utc(); expiry = _utc(30)
        aad = canonical({"direction": "client-to-server", "method": "POST", "path": "/v2/protocol/tasks", "protocol_version": PV, "session_id": self.session_id, "device_id": self.device_id, "request_id": request_id, "sequence": seq, "timestamp": timestamp, "expires_at": expiry, "nonce": b64u(nonce)})
        ciphertext = aes_encrypt(self.c2s, nonce, canonical(application), aad)
        envelope = {"protocol_version": PV, "session_id": self.session_id, "device_id": self.device_id, "request_id": request_id, "sequence": seq, "timestamp": timestamp, "expires_at": expiry, "nonce": b64u(nonce), "ciphertext": b64u(ciphertext)}
        envelope["signature"] = sign(self.device_key, domain("BB2D-P1/client-tasks", aad + b"\0" + nonce + b"\0" + ciphertext))
        if mutation == "extra_outer_field": envelope["extra"] = True
        elif mutation == "missing_outer_field": envelope.pop("signature")
        elif mutation == "malformed_base64url": envelope["nonce"] += "="
        elif mutation == "wrong_signature": envelope["signature"] = b64u(b"x" * 64)
        elif mutation == "modified_ciphertext": envelope["ciphertext"] = b64u(bytes([ciphertext[0] ^ 1]) + ciphertext[1:])
        elif mutation == "stale_timestamp": envelope["timestamp"] = "2020-01-01T00:00:00Z"
        elif mutation == "future_timestamp_outside_window": envelope["timestamp"] = _utc(3600)
        elif mutation == "reused_request_id": envelope["request_id"] = next(iter(self._request_ids), request_id)
        elif mutation == "reused_nonce": envelope["nonce"] = next(iter(self._nonces), b64u(nonce))
        elif mutation == "sequence_regression": envelope["sequence"] = max(1, self.sequence)
        elif mutation == "sequence_gap": envelope["sequence"] = self.sequence + 2
        raw = json.dumps(envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if mutation in {"extra_outer_field", "missing_outer_field", "malformed_base64url", "stale_timestamp", "future_timestamp_outside_window"}:
            self._validate_request(raw)
        return raw

    def protected_send(self, application: dict, *, mutation: str | None = None, sequence: int | None = None) -> tuple[int, dict, dict[str, str]]:
        raw = self._build(application, mutation=mutation, sequence=sequence)
        envelope = self._validate_request(raw) if mutation is None else _parse(raw)
        status, response_raw, headers = self.transport.send("POST", "/v2/protocol/tasks", raw)
        response = self._validate_response(status, response_raw, envelope)
        self.sequence = max(self.sequence, envelope["sequence"])
        self.last_envelope = envelope
        return status, response, headers

    def _validate_response(self, status: int, raw: bytes, request: dict) -> dict:
        response = _parse(raw)
        if set(response) != RESPONSE_FIELDS:
            if set(response) != {"error"} or response["error"] not in PREAUTH_ERROR_VALUES:
                raise ValueError("generic_error_fields")
            return response
        for field in ("session_id", "device_id", "request_id"):
            if response[field] != request[field]: raise ValueError("response_binding")
        if response["sequence"] != request["sequence"] or response["protocol_version"] != PV: raise ValueError("response_sequence")
        nonce = unb64(response["nonce"], 12); ciphertext = unb64(response["ciphertext"]); signature = response["signature"]
        aad = canonical({"direction": "server-to-client", "method": "POST", "path": "/v2/protocol/tasks", "status": status, "protocol_version": PV, "session_id": response["session_id"], "device_id": response["device_id"], "request_id": response["request_id"], "sequence": response["sequence"], "timestamp": response["timestamp"], "expires_at": response["expires_at"], "nonce": response["nonce"]})
        if self.s2c is None: raise ValueError("session_not_open")
        plain = aes_decrypt(self.s2c, nonce, ciphertext, aad)
        if self.server_key is not None:
            unsigned = {key: value for key, value in response.items() if key != "signature"}
            verify(self.server_key, signature, domain("BB2D-P1/server-tasks", canonical({"aad": aad.decode(), "envelope": unsigned})))
        result = _parse(plain)
        if "type" not in result or result["type"] not in {"task_response", "task_error"}: raise ValueError("invalid_application_response")
        return result

    def mutate(self, name: str, application: dict | None = None) -> tuple[int, dict, dict[str, str]]:
        if name not in MUTATORS: raise ValueError("unknown_mutator")
        app = application or self.task_create_immediate()
        return self.protected_send(app, mutation=name)
