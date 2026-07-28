"""Validation and public-safe helpers for one-time device pairing."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

from .database import complete_pairing

UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
ALLOWED = {"pairing_version", "pairing_session_id", "pairing_code", "device_public_key", "device_public_key_format"}


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
