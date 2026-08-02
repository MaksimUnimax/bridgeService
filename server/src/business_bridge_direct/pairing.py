"""Validation and public-safe helpers for one-time device pairing."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.exceptions import InvalidSignature

from .database import complete_pairing, lifecycle_device, revoke_device
from .protocol import domain
from .protocol_crypto import canonical, load_p256_spki, parse_json, sign, unb64, verify

UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ALLOWED = {"pairing_version", "pairing_session_id", "pairing_code", "device_public_key", "device_public_key_format"}
LIFECYCLE_VERSION = "BB2D-L1"
LIFECYCLE_FIELDS = {"lifecycle_version", "action", "device_id", "request_id", "timestamp", "expires_at", "signature"}
LIFECYCLE_ACTIONS = {"status", "revoke"}


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    out: dict[str, object] = {}
    for key, value in pairs:
        if key in out: raise ValueError("duplicate_json_key")
        out[key] = value
    return out


def parse_request(body: bytes) -> dict[str, str]:
    try: data = json.loads(body.decode("utf-8"), object_pairs_hook=_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError): raise ValueError("malformed_request")
    if not isinstance(data, dict) or set(data) != ALLOWED or any(not isinstance(v, str) for v in data.values()): raise ValueError("invalid_fields")
    if data["pairing_version"] != "1" or not UUID4.fullmatch(data["pairing_session_id"]): raise ValueError("invalid_session")
    if not data["pairing_code"] or len(data["pairing_code"]) > 128: raise ValueError("invalid_code")
    if data["device_public_key_format"] != "SPKI_DER_BASE64URL": raise ValueError("invalid_key_format")
    key = data["device_public_key"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", key) or len(key) > 800: raise ValueError("invalid_public_key")
    try: der = base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
    except Exception as exc: raise ValueError("invalid_public_key") from exc
    if base64.urlsafe_b64encode(der).decode().rstrip("=") != key: raise ValueError("invalid_public_key")
    with tempfile.TemporaryDirectory(prefix="bb2-pair-") as td:
        p = Path(td) / "key.der"; p.write_bytes(der)
        r = subprocess.run(["/usr/bin/openssl", "pkey", "-pubin", "-inform", "DER", "-in", str(p), "-outform", "DER"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, timeout=3)
        if r.returncode != 0 or r.stdout != der: raise ValueError("invalid_public_key")
        info = subprocess.run(["/usr/bin/openssl", "pkey", "-pubin", "-inform", "DER", "-in", str(p), "-text", "-noout"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False, timeout=3)
        if info.returncode != 0 or (b"prime256v1" not in info.stdout and b"P-256" not in info.stdout): raise ValueError("invalid_public_key")
    return data


def fingerprint(public_key: str) -> str:
    return "sha256:" + hashlib.sha256(public_key.encode("ascii")).hexdigest()


def pair(path: str, body: bytes, now: str | None = None) -> tuple[bool, dict[str, str]]:
    data = parse_request(body)
    ok, result = complete_pairing(path, data["pairing_session_id"], data["pairing_code"], data["device_public_key"], now)
    if ok:
        result["instance_id"] = ""  # filled by HTTP service from stable identity
    return ok, result


def _lifecycle_timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("invalid_timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or not value.endswith("Z") or parsed.microsecond or parsed.isoformat(timespec="seconds").replace("+00:00", "Z") != value:
            raise ValueError
        return parsed
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid_timestamp") from exc


def _lifecycle_uuid(value: object) -> bool:
    return isinstance(value, str) and UUID4.fullmatch(value) is not None


def _lifecycle_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def device_lifecycle(path: str, body: bytes, identity: dict[str, object], server_key: object) -> tuple[int, dict[str, str]]:
    """Authenticate and execute only signed status or idempotent revoke."""
    data = parse_json(body, LIFECYCLE_FIELDS)
    if any(type(data[name]) is not str for name in LIFECYCLE_FIELDS):
        raise ValueError("malformed_request")
    if data["lifecycle_version"] != LIFECYCLE_VERSION or data["action"] not in LIFECYCLE_ACTIONS:
        raise ValueError("malformed_request")
    if not _lifecycle_uuid(data["device_id"]) or not _lifecycle_uuid(data["request_id"]):
        raise ValueError("malformed_request")
    timestamp = _lifecycle_timestamp(data["timestamp"])
    expires_at = _lifecycle_timestamp(data["expires_at"])
    now = _lifecycle_now()
    lifetime = (expires_at - timestamp).total_seconds()
    if expires_at <= timestamp or lifetime > 60 or abs((now - timestamp).total_seconds()) > 30 or expires_at <= now:
        raise ValueError("expired_message" if expires_at > timestamp and lifetime <= 60 else "invalid_timestamp")
    # Lookup is intentionally limited to this device's SPKI and status.
    record = lifecycle_device(path, data["device_id"])
    if not record:
        raise PermissionError("device_lifecycle_rejected")
    try:
        device_key, status = record
        key, _ = load_p256_spki(device_key)
        unb64(data["signature"], 64)
        verify(key, data["signature"], domain("BB2D-L1/client-device", canonical({
            "action": data["action"], "device_id": data["device_id"], "expires_at": data["expires_at"],
            "lifecycle_version": LIFECYCLE_VERSION, "method": "POST", "path": "/v2/pairing/device",
            "request_id": data["request_id"], "timestamp": data["timestamp"],
        })))
    except (InvalidSignature, ValueError, TypeError, KeyError) as exc:
        raise PermissionError("device_lifecycle_rejected") from exc
    if data["action"] == "revoke":
        result, _ = revoke_device(path, data["device_id"])
        if result not in {"revoked", "already_revoked"}:
            raise PermissionError("device_lifecycle_rejected")
        status = "REVOKED"
    response_now = _lifecycle_now()
    response_timestamp = response_now.isoformat().replace("+00:00", "Z")
    response_expires = (response_now + timedelta(seconds=60)).isoformat().replace("+00:00", "Z")
    response = {
        "lifecycle_version": LIFECYCLE_VERSION, "action": data["action"], "device_id": data["device_id"],
        "instance_id": identity["instance_id"], "server_fingerprint": identity["fingerprint"],
        "request_id": data["request_id"], "status": status, "timestamp": response_timestamp, "expires_at": response_expires,
    }
    response["signature"] = sign(server_key, domain("BB2D-L1/server-device", canonical({"method": "POST", "path": "/v2/pairing/device", "status": 200, "response": response})))
    return 200, response
