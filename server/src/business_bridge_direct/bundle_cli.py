"""Operator CLI for creating a single BB2D1 connection bundle."""
from __future__ import annotations

import argparse
import base64
import grp
import hashlib
import sys
import time
from datetime import datetime, timezone

from . import bundle
from .config import load_config
from .database import check_database, create_session, initialize_database, revoke_session, session_status
from .identity import validate_identity


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _generic_error() -> int:
    sys.stderr.write('{"error":"bundle_creation_failed"}\n')
    return 1


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise ValueError("invalid_arguments")


def _transient_database_error(exc: BaseException) -> bool:
    message = str(exc).lower()
    return "busy" in message or "locked" in message


def _cleanup_session(database_path: str, session_id: str) -> bool:
    """Revoke and verify a failed bundle session, with bounded SQLite retries."""
    for attempt in range(3):
        try:
            revoke_session(database_path, session_id)
            status = session_status(database_path, session_id)
            return status is None or status.get("status") != "ACTIVE"
        except Exception as exc:
            if not _transient_database_error(exc) or attempt == 2:
                return False
            time.sleep(0.01 * (attempt + 1))
    return False


def _public_key_fingerprint(spki_b64url: str) -> str:
    raw = base64.urlsafe_b64decode(spki_b64url + "=" * (-len(spki_b64url) % 4))
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def _build_payload(config, identity: dict[str, object], session_id: str, code: str, expires_at: str, issued_at: str) -> dict[str, object]:
    public_key = identity["public_key_spki"]
    fingerprint = _public_key_fingerprint(public_key)
    if fingerprint != identity["fingerprint"]:
        raise ValueError("identity_fingerprint_mismatch")
    return {
        "bundle_version": bundle.BUNDLE_VERSION,
        "expires_at": expires_at,
        "host": config.listen_host,
        "instance_id": identity["instance_id"],
        "issued_at": issued_at,
        "pairing_code": code,
        "pairing_session_id": session_id,
        "port": config.listen_port,
        "rotation_generation": identity["rotation_generation"],
        "server_fingerprint": fingerprint,
        "server_public_key": public_key,
        "server_public_key_format": identity["public_key_format"],
        "server_signing_algorithm": identity["signing_algorithm"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = _ArgumentParser(prog="python -m business_bridge_direct.bundle_cli")
    subparsers = parser.add_subparsers(dest="command", required=True, parser_class=_ArgumentParser)
    create = subparsers.add_parser("create")
    create.add_argument("--config", default="/etc/business-bridge-2-direct/service.json")
    create.add_argument("--ttl", type=int, default=600)
    session_id: str | None = None
    try:
        args = parser.parse_args(argv)
        if args.command != "create":
            raise ValueError("invalid_command")
        if not 300 <= args.ttl <= 600:
            raise ValueError("invalid_ttl")
        config = load_config(args.config)
        service_gid = grp.getgrnam("business-bridge-direct").gr_gid
        identity = validate_identity(config, service_gid)
        initialize_database(config.database_path)
        if not check_database(config.database_path):
            raise ValueError("database_not_ready")
        issued_at = _utc_now()
        session_id, pairing_code, expires_at = create_session(config.database_path, args.ttl, now=issued_at)
        payload = _build_payload(config, identity, session_id, pairing_code, expires_at, issued_at)
        bundle_line = bundle.encode_bundle(payload)
        decoded = bundle.decode_bundle(bundle_line, now=issued_at)
        if decoded != payload:
            raise ValueError("bundle_self_validation_failed")
        record = bundle_line + "\n"
        write_result = sys.stdout.write(record)
        if write_result != len(record):
            raise OSError("short_stdout_write")
        sys.stdout.flush()
        return 0
    except Exception:
        if session_id is not None:
            _cleanup_session(config.database_path, session_id)
        return _generic_error()


if __name__ == "__main__":
    raise SystemExit(main())
