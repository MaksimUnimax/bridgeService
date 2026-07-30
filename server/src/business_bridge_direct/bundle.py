"""Side-effect-free BB2D1 bundle serialization and validation."""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
except Exception:  # pragma: no cover - fallback for stripped runtime images
    serialization = None
    ec = None

BUNDLE_VERSION = "BB2D1"
SERVER_SIGNING_ALGORITHM = "ECDSA_P256_SHA256"
SERVER_PUBLIC_KEY_FORMAT = "SPKI_DER_BASE64URL"
BUNDLE_MAX_LENGTH = 4096
PAYLOAD_FIELDS = (
    "bundle_version",
    "expires_at",
    "host",
    "instance_id",
    "issued_at",
    "pairing_code",
    "pairing_session_id",
    "port",
    "rotation_generation",
    "server_fingerprint",
    "server_public_key",
    "server_public_key_format",
    "server_signing_algorithm",
)

_B64URL = re.compile(r"^[A-Za-z0-9_-]+$")
_UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_HEX32 = re.compile(r"^[0-9a-f]{32}$")


class BundleError(ValueError):
    """Validation failure for a BB2D1 bundle."""


def validate_checksum(payload_bytes: bytes, checksum_bytes: bytes) -> None:
    if not isinstance(payload_bytes, (bytes, bytearray, memoryview)) or not isinstance(checksum_bytes, (bytes, bytearray, memoryview)):
        raise BundleError("invalid_checksum")
    payload_bytes = bytes(payload_bytes)
    checksum_bytes = bytes(checksum_bytes)
    if len(checksum_bytes) != 32:
        raise BundleError("invalid_checksum")
    expected = hashlib.sha256(checksum_domain_bytes(payload_bytes)).digest()
    if not hmac.compare_digest(checksum_bytes, expected):
        raise BundleError("checksum_mismatch")


def validate_server_public_key(server_public_key: Any, server_fingerprint: Any) -> bytes:
    decoded = _b64url_decode(server_public_key, "server_public_key")
    if not 50 <= len(decoded) <= 512:
        raise BundleError("invalid_server_public_key")
    validated_by_crypto = False
    if serialization is not None and ec is not None:
        try:
            public_key = serialization.load_der_public_key(decoded)
            validated_by_crypto = isinstance(public_key, ec.EllipticCurvePublicKey) and public_key.curve.name in {"secp256r1", "prime256v1"}
        except Exception:
            validated_by_crypto = False
    if not validated_by_crypto:
        openssl = os.environ.get("OPENSSL", "/usr/bin/openssl")
        try:
            with tempfile.TemporaryDirectory(prefix="bb2d1-bundle-") as td:
                spki = Path(td) / "server_public_key.der"
                spki.write_bytes(decoded)
                result = subprocess.run(
                    [openssl, "pkey", "-pubin", "-inform", "DER", "-in", str(spki), "-text", "-noout"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
        except OSError as exc:
            raise BundleError("invalid_server_public_key") from exc
        if result.returncode != 0 or ("prime256v1" not in result.stdout and "P-256" not in result.stdout):
            raise BundleError("invalid_server_public_key")
    if not isinstance(server_fingerprint, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", server_fingerprint):
        raise BundleError("invalid_server_fingerprint")
    if server_fingerprint != "sha256:" + hashlib.sha256(decoded).hexdigest():
        raise BundleError("fingerprint_mismatch")
    return decoded


def validate_payload(value: Any) -> dict[str, Any]:
    return _validate_payload_object(value)


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise BundleError("duplicate_json_key")
        result[key] = value
    return result


def _utc_timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str):
        raise BundleError(f"invalid_{field}")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BundleError(f"invalid_{field}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0) or parsed.microsecond != 0:
        raise BundleError(f"invalid_{field}")
    if parsed.isoformat(timespec="seconds").replace("+00:00", "Z") != value:
        raise BundleError(f"invalid_{field}")
    return parsed


def _uuid4(value: Any, field: str) -> str:
    if not isinstance(value, str) or value != value.lower():
        raise BundleError(f"invalid_{field}")
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise BundleError(f"invalid_{field}") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise BundleError(f"invalid_{field}")
    return value


def _ipv4(value: Any) -> str:
    if not isinstance(value, str):
        raise BundleError("invalid_host")
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError as exc:
        raise BundleError("invalid_host") from exc
    if str(address) != value:
        raise BundleError("noncanonical_host")
    return value


def _b64url_decode(value: Any, field: str) -> bytes:
    if not isinstance(value, str) or not value or "=" in value or any(ch in value for ch in "\r\n"):
        raise BundleError(f"invalid_{field}")
    if not _B64URL.fullmatch(value):
        raise BundleError(f"invalid_{field}")
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise BundleError(f"invalid_{field}") from exc
    if base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != value:
        raise BundleError(f"invalid_{field}")
    return decoded


def _canonical_json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")


def _validate_payload_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != set(PAYLOAD_FIELDS):
        raise BundleError("invalid_payload")
    bundle_version = value["bundle_version"]
    if bundle_version != BUNDLE_VERSION:
        raise BundleError("invalid_bundle_version")
    issued_at = _utc_timestamp(value["issued_at"], "issued_at")
    expires_at = _utc_timestamp(value["expires_at"], "expires_at")
    if expires_at <= issued_at:
        raise BundleError("invalid_expiry")
    ttl = int((expires_at - issued_at).total_seconds())
    if timedelta(seconds=ttl) != (expires_at - issued_at) or ttl < 300 or ttl > 600:
        raise BundleError("invalid_ttl")
    host = _ipv4(value["host"])
    port = value["port"]
    if type(port) is not int or not 1 <= port <= 65535:
        raise BundleError("invalid_port")
    instance_id = _uuid4(value["instance_id"], "instance_id")
    pairing_session_id = _uuid4(value["pairing_session_id"], "pairing_session_id")
    pairing_code = value["pairing_code"]
    if not isinstance(pairing_code, str) or not _HEX32.fullmatch(pairing_code):
        raise BundleError("invalid_pairing_code")
    rotation_generation = value["rotation_generation"]
    if type(rotation_generation) is not int or rotation_generation < 1:
        raise BundleError("invalid_rotation_generation")
    server_signing_algorithm = value["server_signing_algorithm"]
    if server_signing_algorithm != SERVER_SIGNING_ALGORITHM:
        raise BundleError("invalid_server_signing_algorithm")
    server_public_key_format = value["server_public_key_format"]
    if server_public_key_format != SERVER_PUBLIC_KEY_FORMAT:
        raise BundleError("invalid_server_public_key_format")
    server_public_key = validate_server_public_key(value["server_public_key"], value["server_fingerprint"])
    server_fingerprint = value["server_fingerprint"]
    normalized = {
        "bundle_version": bundle_version,
        "expires_at": value["expires_at"],
        "host": host,
        "instance_id": instance_id,
        "issued_at": value["issued_at"],
        "pairing_code": pairing_code,
        "pairing_session_id": pairing_session_id,
        "port": port,
        "rotation_generation": rotation_generation,
        "server_fingerprint": server_fingerprint,
        "server_public_key": value["server_public_key"],
        "server_public_key_format": server_public_key_format,
        "server_signing_algorithm": server_signing_algorithm,
    }
    if _canonical_json_bytes(normalized) != _canonical_json_bytes(value):
        raise BundleError("noncanonical_payload")
    return normalized


def canonical_payload_bytes(payload: dict[str, Any]) -> bytes:
    return _canonical_json_bytes(validate_payload(payload))


def checksum_domain_bytes(payload_bytes: bytes) -> bytes:
    return b"BB2D1\x00" + payload_bytes


def encode_bundle(payload: dict[str, Any]) -> str:
    payload_bytes = canonical_payload_bytes(payload)
    encoded_payload = base64.urlsafe_b64encode(payload_bytes).decode("ascii").rstrip("=")
    checksum = hashlib.sha256(checksum_domain_bytes(payload_bytes)).digest()
    encoded_checksum = base64.urlsafe_b64encode(checksum).decode("ascii").rstrip("=")
    return f"{BUNDLE_VERSION}.{encoded_payload}.{encoded_checksum}"


def _strict_bundle_string(value: Any) -> str:
    if not isinstance(value, str):
        raise TypeError("bundle_must_be_str")
    if not value or len(value) > BUNDLE_MAX_LENGTH or any(ch in value for ch in "\r\n") or any(ch.isspace() for ch in value):
        raise BundleError("invalid_bundle")
    return value


def _decode_bundle_parts(bundle: str) -> tuple[bytes, bytes]:
    parts = bundle.split(".")
    if len(parts) != 3 or parts[0] != BUNDLE_VERSION:
        raise BundleError("invalid_bundle")
    payload_segment, checksum_segment = parts[1], parts[2]
    payload_bytes = _b64url_decode(payload_segment, "payload")
    checksum_bytes = _b64url_decode(checksum_segment, "checksum")
    if len(checksum_bytes) != 32 or len(checksum_segment) != 43:
        raise BundleError("invalid_checksum")
    if not payload_bytes:
        raise BundleError("invalid_payload")
    return payload_bytes, checksum_bytes


def decode_bundle(bundle: str, *, now: str | datetime | None = None) -> dict[str, Any]:
    bundle = _strict_bundle_string(bundle)
    payload_bytes, checksum_bytes = _decode_bundle_parts(bundle)
    validate_checksum(payload_bytes, checksum_bytes)
    try:
        parsed = json.loads(payload_bytes.decode("utf-8"), object_pairs_hook=_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError, BundleError) as exc:
        raise BundleError("invalid_payload") from exc
    payload = validate_payload(parsed)
    if _canonical_json_bytes(payload) != payload_bytes:
        raise BundleError("noncanonical_payload")
    validator_now = _utc_timestamp(now, "validator_time") if isinstance(now, str) else now
    if isinstance(validator_now, datetime):
        if validator_now.tzinfo is None:
            validator_now = validator_now.replace(tzinfo=timezone.utc)
        validator_now = validator_now.astimezone(timezone.utc).replace(microsecond=0)
        expires = _utc_timestamp(payload["expires_at"], "expires_at")
        if expires <= validator_now:
            raise BundleError("expired_bundle")
    return payload


__all__ = [
    "BUNDLE_VERSION",
    "BUNDLE_MAX_LENGTH",
    "BundleError",
    "PAYLOAD_FIELDS",
    "SERVER_PUBLIC_KEY_FORMAT",
    "SERVER_SIGNING_ALGORITHM",
    "canonical_payload_bytes",
    "checksum_domain_bytes",
    "decode_bundle",
    "encode_bundle",
    "validate_checksum",
    "validate_payload",
    "validate_server_public_key",
]
