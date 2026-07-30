"""Operator CLI for creating a single BB2D1 connection bundle."""
from __future__ import annotations

import argparse
import base64
import grp
import hashlib
import sys
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
    parser = argparse.ArgumentParser(prog="python -m business_bridge_direct.bundle_cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create")
    create.add_argument("--config", default="/etc/business-bridge-2-direct/service.json")
    create.add_argument("--ttl", type=int, default=600)
    args = parser.parse_args(argv)
    if args.command != "create":
        return _generic_error()
    session_id: str | None = None
    try:
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
        sys.stdout.write(bundle_line + "\n")
        sys.stdout.flush()
        return 0
    except BrokenPipeError:
        if session_id is not None:
            try:
                revoke_session(config.database_path, session_id)
                status = session_status(config.database_path, session_id)
                if status and status.get("status") == "ACTIVE":
                    raise RuntimeError("session_revocation_failed")
            except Exception:
                pass
        return _generic_error()
    except Exception:
        if session_id is not None:
            try:
                revoke_session(config.database_path, session_id)
                status = session_status(config.database_path, session_id)
                if status and status.get("status") == "ACTIVE":
                    raise RuntimeError("session_revocation_failed")
            except Exception:
                pass
        return _generic_error()


if __name__ == "__main__":
    raise SystemExit(main())
