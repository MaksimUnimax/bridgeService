"""Fail-closed Direct server identity provisioning and validation."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

IDENTITY_VERSION = 1
ALGORITHM = "ECDSA_P256_SHA256"
PUBLIC_FORMAT = "SPKI_DER_BASE64URL"
FIELDS = ("identity_version", "instance_id", "signing_algorithm", "public_key_format", "public_key_spki", "fingerprint", "created_at", "rotation_generation", "previous_fingerprint", "rotated_at", "rotation_reason")
_UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_B64 = re.compile(r"^[A-Za-z0-9_-]+$")


class IdentityError(ValueError):
    pass


def _safe_run(openssl: str, args: list[str], timeout: float = 5, stdin: bytes | None = None) -> bytes:
    env = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}
    try:
        result = subprocess.run([openssl, *args], input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False, close_fds=True, env=env, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise IdentityError("IDENTITY_CRYPTO_FAILURE") from exc
    if result.returncode != 0:
        raise IdentityError("IDENTITY_CRYPTO_FAILURE")
    return result.stdout


def _safe_file(path: Path, mode: int, group: int | None = None) -> None:
    try:
        st = path.lstat()
    except OSError as exc:
        raise IdentityError("IDENTITY_FILE_INVALID") from exc
    if path.is_symlink() or not path.is_file():
        raise IdentityError("IDENTITY_FILE_INVALID")
    if st.st_uid != 0 or (group is not None and st.st_gid != group) or (st.st_mode & 0o777) != mode:
        raise IdentityError("IDENTITY_PERMISSION_INVALID")
    if st.st_nlink != 1:
        raise IdentityError("IDENTITY_HARDLINK_INVALID")


def _safe_parent(path: Path, owner: int, group: int, mode: int, exact: bool = False) -> None:
    try:
        st = path.lstat()
    except OSError as exc:
        raise IdentityError("IDENTITY_PARENT_INVALID") from exc
    if path.is_symlink() or not path.is_dir() or st.st_uid != owner or st.st_gid != group:
        raise IdentityError("IDENTITY_PARENT_INVALID")
    actual = st.st_mode & 0o777
    if (exact and actual != mode) or (not exact and (actual & 0o022 or actual & 0o007 and mode & 0o007 == 0)):
        raise IdentityError("IDENTITY_PARENT_PERMISSION_INVALID")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    if not value or not _B64.fullmatch(value) or "=" in value:
        raise IdentityError("IDENTITY_FORMAT_INVALID")
    try:
        data = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise IdentityError("IDENTITY_FORMAT_INVALID") from exc
    if _b64(data) != value:
        raise IdentityError("IDENTITY_FORMAT_INVALID")
    return data


def fingerprint(spki: bytes) -> str:
    return "sha256:" + hashlib.sha256(spki).hexdigest()


def _timestamp(value: str) -> None:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None or dt.utcoffset() is None or not value.endswith("Z") or dt.isoformat(timespec="seconds").replace("+00:00", "Z") != value:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise IdentityError("IDENTITY_METADATA_INVALID") from exc


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise IdentityError("IDENTITY_METADATA_INVALID")
        result[key] = value
    return result


def validate_metadata(path: Path, group: int | None = None) -> dict[str, Any]:
    _safe_file(path, 0o640, group)
    try:
        data = json.loads(path.read_bytes().decode("utf-8"), object_pairs_hook=_pairs)
    except Exception as exc:
        raise IdentityError("IDENTITY_METADATA_INVALID") from exc
    if not isinstance(data, dict) or tuple(data) != FIELDS:
        raise IdentityError("IDENTITY_METADATA_INVALID")
    if type(data["identity_version"]) is not int or data["identity_version"] != 1 or not isinstance(data["instance_id"], str) or not _UUID4.fullmatch(data["instance_id"]):
        raise IdentityError("IDENTITY_METADATA_INVALID")
    if data["signing_algorithm"] != ALGORITHM or data["public_key_format"] != PUBLIC_FORMAT:
        raise IdentityError("IDENTITY_METADATA_INVALID")
    spki = _unb64(data["public_key_spki"])
    if not 50 <= len(spki) <= 512 or not data["fingerprint"] == fingerprint(spki) or not re.fullmatch(r"sha256:[0-9a-f]{64}", data["fingerprint"]):
        raise IdentityError("IDENTITY_FINGERPRINT_MISMATCH")
    _timestamp(data["created_at"])
    if type(data["rotation_generation"]) is not int or data["rotation_generation"] != 1 or any(data[k] is not None for k in ("previous_fingerprint", "rotated_at", "rotation_reason")):
        raise IdentityError("IDENTITY_METADATA_INVALID")
    return data


def _public_and_possession(config: Any, key: Path, expected: bytes) -> None:
    with tempfile.TemporaryDirectory(prefix="bb2-id-", dir=str(key.parent)) as td:
        public_der = Path(td) / "public.der"
        public_pem = Path(td) / "public.pem"
        challenge = Path(td) / "challenge"
        signature = Path(td) / "signature"
        public_der.write_bytes(_safe_run(config.openssl_path, ["pkey", "-in", str(key), "-pubout", "-outform", "DER"]))
        if public_der.read_bytes() != expected:
            raise IdentityError("IDENTITY_PUBLIC_KEY_MISMATCH")
        # Inspect only the derived public key. Private scalar output is never requested.
        curve_info = _safe_run(config.openssl_path, ["pkey", "-pubin", "-inform", "DER", "-in", str(public_der), "-text", "-noout"])
        if b"ASN1 OID: prime256v1" not in curve_info and b"NIST CURVE: P-256" not in curve_info:
            raise IdentityError("IDENTITY_CURVE_INVALID")
        challenge.write_bytes(secrets.token_bytes(32))
        _safe_run(config.openssl_path, ["pkey", "-in", str(key), "-pubout"], timeout=5)
        public_pem.write_bytes(_safe_run(config.openssl_path, ["pkey", "-in", str(key), "-pubout"]))
        signature.write_bytes(_safe_run(config.openssl_path, ["dgst", "-sha256", "-sign", str(key), str(challenge)]))
        _safe_run(config.openssl_path, ["dgst", "-sha256", "-verify", str(public_pem), "-signature", str(signature), str(challenge)])


def _fsync(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_exclusive(path: Path, data: bytes, mode: int) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "wb") as stream:
            fd = -1
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        if fd >= 0:
            os.close(fd)
    os.chmod(path, mode)


def validate_identity(config: Any, group: int | None = None) -> dict[str, Any]:
    key, metadata = Path(config.server_signing_private_key_path), Path(config.identity_metadata_path)
    _safe_parent(key.parent, 0, group if group is not None else key.parent.stat().st_gid, 0o750, exact=True)
    _safe_parent(metadata.parent, metadata.parent.stat().st_uid, group if group is not None else metadata.parent.stat().st_gid, metadata.parent.stat().st_mode & 0o777)
    if not os.path.lexists(key) or not os.path.lexists(metadata):
        raise IdentityError("IDENTITY_PARTIAL_STATE")
    data = validate_metadata(metadata, group)
    _safe_file(key, 0o640, group)
    if not key.read_bytes().startswith(b"-----BEGIN PRIVATE KEY-----"):
        raise IdentityError("IDENTITY_PRIVATE_FORMAT_INVALID")
    _public_and_possession(config, key, _unb64(data["public_key_spki"]))
    return data


def init_identity(config: Any, group: int) -> tuple[dict[str, Any], str]:
    key, metadata = Path(config.server_signing_private_key_path), Path(config.identity_metadata_path)
    _safe_parent(key.parent, 0, group, 0o750, exact=True)
    _safe_parent(metadata.parent, metadata.parent.stat().st_uid, group, metadata.parent.stat().st_mode & 0o777)
    key_exists, metadata_exists = os.path.lexists(key), os.path.lexists(metadata)
    if key_exists != metadata_exists:
        raise IdentityError("IDENTITY_PARTIAL_STATE")
    if key_exists:
        return validate_identity(config, group), "unchanged"
    old_umask = os.umask(0o077)
    temporary: list[Path] = []
    try:
        key_fd, key_tmp_name = tempfile.mkstemp(prefix=".identity-key-", dir=key.parent)
        os.close(key_fd)
        key_tmp = Path(key_tmp_name); temporary.append(key_tmp)
        pub_tmp = key_tmp.with_name(key_tmp.name + ".pub"); temporary.append(pub_tmp)
        meta_tmp = metadata.parent / (".identity-meta-" + uuid.uuid4().hex); temporary.append(meta_tmp)
        with key_tmp.open("wb") as stream:
            result = subprocess.run([config.openssl_path, "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:prime256v1"], stdout=stream, stderr=subprocess.PIPE, shell=False, close_fds=True, env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}, check=False, timeout=5)
            if result.returncode != 0:
                raise IdentityError("IDENTITY_CRYPTO_FAILURE")
            stream.flush(); os.fsync(stream.fileno())
        os.chmod(key_tmp, 0o640); os.chown(key_tmp, 0, group)
        _write_exclusive(pub_tmp, _safe_run(config.openssl_path, ["pkey", "-in", str(key_tmp), "-pubout", "-outform", "DER"]), 0o600)
        public = pub_tmp.read_bytes()
        data = {"identity_version": 1, "instance_id": str(uuid.uuid4()), "signing_algorithm": ALGORITHM, "public_key_format": PUBLIC_FORMAT, "public_key_spki": _b64(public), "fingerprint": fingerprint(public), "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "rotation_generation": 1, "previous_fingerprint": None, "rotated_at": None, "rotation_reason": None}
        _write_exclusive(meta_tmp, (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode(), 0o640); os.chown(meta_tmp, 0, group)
        _public_and_possession(config, key_tmp, public)
        if os.path.lexists(key) or os.path.lexists(metadata):
            raise IdentityError("IDENTITY_PARTIAL_STATE")
        os.replace(key_tmp, key); _fsync(key.parent); temporary.remove(key_tmp)
        os.replace(meta_tmp, metadata); _fsync(metadata.parent); temporary.remove(meta_tmp)
        return validate_identity(config, group), "created"
    finally:
        os.umask(old_umask)
        for path in temporary:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
