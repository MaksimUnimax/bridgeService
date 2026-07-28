"""Fail-closed Direct server identity provisioning and validation."""
from __future__ import annotations

import base64, hashlib, json, os, re, secrets, subprocess, tempfile, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

IDENTITY_VERSION = 1
ALGORITHM = "ECDSA_P256_SHA256"
PUBLIC_FORMAT = "SPKI_DER_BASE64URL"
_UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_B64 = re.compile(r"^[A-Za-z0-9_-]+$")
FIELDS = ("identity_version","instance_id","signing_algorithm","public_key_format","public_key_spki","fingerprint","created_at","rotation_generation","previous_fingerprint","rotated_at","rotation_reason")

class IdentityError(ValueError): pass

def _safe_run(openssl: str, args: list[str], timeout: float = 5, stdin: bytes | None = None) -> bytes:
    if any("private" in x.lower() or x in ("-sign", "-key") for x in args):
        pass
    env = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}
    try:
        p = subprocess.run([openssl, *args], input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False, close_fds=True, env=env, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise IdentityError("IDENTITY_CRYPTO_FAILURE") from exc
    if p.returncode != 0:
        raise IdentityError("IDENTITY_CRYPTO_FAILURE")
    return p.stdout

def _safe_file(path: Path, mode: int, group: int | None = None) -> None:
    if path.is_symlink() or not path.is_file(): raise IdentityError("IDENTITY_FILE_INVALID")
    st = path.stat()
    if st.st_uid != 0 or (group is not None and st.st_gid != group) or (st.st_mode & 0o777) != mode: raise IdentityError("IDENTITY_PERMISSION_INVALID")
    if st.st_nlink != 1: raise IdentityError("IDENTITY_HARDLINK_INVALID")

def _b64(data: bytes) -> str: return base64.urlsafe_b64encode(data).decode().rstrip("=")
def _unb64(value: str) -> bytes:
    if not value or not _B64.fullmatch(value) or "=" in value: raise IdentityError("IDENTITY_FORMAT_INVALID")
    try: data = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc: raise IdentityError("IDENTITY_FORMAT_INVALID") from exc
    if _b64(data) != value: raise IdentityError("IDENTITY_FORMAT_INVALID")
    return data

def fingerprint(spki: bytes) -> str: return "sha256:" + hashlib.sha256(spki).hexdigest()
def _timestamp(value: str) -> None:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None or dt.utcoffset() is None or not value.endswith("Z"): raise ValueError
    except ValueError as exc: raise IdentityError("IDENTITY_METADATA_INVALID") from exc

def validate_metadata(path: Path, group: int | None = None) -> dict[str, Any]:
    _safe_file(path, 0o640, group)
    try:
        raw = path.read_bytes(); data = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs)
    except Exception as exc: raise IdentityError("IDENTITY_METADATA_INVALID") from exc
    if not isinstance(data, dict) or tuple(data) != FIELDS: raise IdentityError("IDENTITY_METADATA_INVALID")
    if data["identity_version"] != 1 or not isinstance(data["identity_version"], int): raise IdentityError("IDENTITY_METADATA_INVALID")
    if not isinstance(data["instance_id"], str) or not _UUID4.fullmatch(data["instance_id"]): raise IdentityError("IDENTITY_METADATA_INVALID")
    if data["signing_algorithm"] != ALGORITHM or data["public_key_format"] != PUBLIC_FORMAT: raise IdentityError("IDENTITY_METADATA_INVALID")
    spki = _unb64(data["public_key_spki"])
    if not 50 <= len(spki) <= 512 or data["fingerprint"] != fingerprint(spki): raise IdentityError("IDENTITY_FINGERPRINT_MISMATCH")
    if not isinstance(data["fingerprint"], str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", data["fingerprint"]): raise IdentityError("IDENTITY_METADATA_INVALID")
    _timestamp(data["created_at"])
    if type(data["rotation_generation"]) is not int or data["rotation_generation"] != 1: raise IdentityError("IDENTITY_METADATA_INVALID")
    if any(data[k] is not None for k in ("previous_fingerprint","rotated_at","rotation_reason")): raise IdentityError("IDENTITY_METADATA_INVALID")
    return data

def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result: raise IdentityError("IDENTITY_METADATA_INVALID")
        result[key] = value
    return result

def validate_identity(config: Any, group: int | None = None) -> dict[str, Any]:
    key = Path(config.server_signing_private_key_path); metadata = Path(config.identity_metadata_path)
    if not key.exists() or not metadata.exists(): raise IdentityError("IDENTITY_PARTIAL_STATE")
    data = validate_metadata(metadata, group)
    _safe_file(key, 0o640, group)
    if key.read_bytes().splitlines()[0] != b"-----BEGIN PRIVATE KEY-----": raise IdentityError("IDENTITY_PRIVATE_FORMAT_INVALID")
    with tempfile.TemporaryDirectory(prefix="bb2-id-", dir=str(metadata.parent)) as td:
        pub = _safe_run(config.openssl_path, ["pkey", "-in", str(key), "-pubout", "-outform", "DER"])
        if pub != _unb64(data["public_key_spki"]): raise IdentityError("IDENTITY_PUBLIC_KEY_MISMATCH")
        key_text = _safe_run(config.openssl_path, ["pkey", "-in", str(key), "-text", "-noout"])
        if b"ASN1 OID: prime256v1" not in key_text and b"NIST CURVE: P-256" not in key_text: raise IdentityError("IDENTITY_CURVE_INVALID")
        challenge = secrets.token_bytes(32); cp = Path(td) / "challenge"; sig = Path(td) / "signature"; cp.write_bytes(challenge)
        _safe_run(config.openssl_path, ["dgst", "-sha256", "-sign", str(key), "-out", str(sig), str(cp)])
        pem = Path(td) / "pub.pem"; pem.write_bytes(_safe_run(config.openssl_path, ["pkey", "-in", str(key), "-pubout"]))
        _safe_run(config.openssl_path, ["dgst", "-sha256", "-verify", str(pem), "-signature", str(sig), str(cp)])
    return data

def init_identity(config: Any, group: int) -> tuple[dict[str, Any], str]:
    key, metadata = Path(config.server_signing_private_key_path), Path(config.identity_metadata_path)
    if key.exists() != metadata.exists(): raise IdentityError("IDENTITY_PARTIAL_STATE")
    if key.exists(): return validate_identity(config, group), "unchanged"
    key.parent.mkdir(mode=0o750, parents=True, exist_ok=True); metadata.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="bb2-id-init-", dir=str(key.parent)) as td:
        kp, sp = Path(td) / "key.pem", Path(td) / "pub.der"
        _safe_run(config.openssl_path, ["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-out", str(kp)])
        os.chmod(kp, 0o600); sp.write_bytes(_safe_run(config.openssl_path, ["pkey", "-in", str(kp), "-pubout", "-outform", "DER"]))
        data = {"identity_version":1,"instance_id":str(uuid.uuid4()),"signing_algorithm":ALGORITHM,"public_key_format":PUBLIC_FORMAT,"public_key_spki":_b64(sp.read_bytes()),"fingerprint":fingerprint(sp.read_bytes()),"created_at":datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),"rotation_generation":1,"previous_fingerprint":None,"rotated_at":None,"rotation_reason":None}
        target = Path(td) / "identity.json"; target.write_text(json.dumps(data, ensure_ascii=False, separators=(",",":")) + "\n", encoding="utf-8"); os.chmod(target, 0o600)
        os.replace(kp, key); os.chmod(key, 0o640); os.chown(key, 0, group)
        os.replace(target, metadata); os.chmod(metadata, 0o640); os.chown(metadata, 0, group)
    return validate_identity(config, group), "created"
