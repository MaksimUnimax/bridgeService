"""Root/operator CLI. The create command is the sole plaintext-code output."""
from __future__ import annotations
import argparse, json
from .database import create_session, device_status, revoke_device, revoke_session, session_status

def main(argv=None) -> int:
    p=argparse.ArgumentParser(); p.add_argument("command", choices=("create","session-status","revoke-session","device-status","revoke-device")); p.add_argument("id", nargs="?"); p.add_argument("--config", default="/etc/business-bridge-2-direct/service.json"); p.add_argument("--ttl", type=int, default=600); a=p.parse_args(argv)
    try:
        import json as _json
        from .config import load_config
        cfg=load_config(a.config); db=cfg.database_path
        if a.command == "create":
            sid, code, expires=create_session(db,a.ttl); print(json.dumps({"session_id":sid,"pairing_code":code,"expires_at":expires},separators=(",",":"))); return 0
        if not a.id: raise ValueError("id_required")
        if a.command == "session-status": result=session_status(db,a.id)
        elif a.command == "device-status": result=device_status(db,a.id)
        elif a.command == "revoke-session": result={"result":revoke_session(db,a.id)[0]}
        else: result={"result":revoke_device(db,a.id)[0]}
        print(json.dumps(result if result is not None else {"result":"not_found"},separators=(",",":"))); return 0
    except Exception:
        print(json.dumps({"error":"operation_failed"},separators=(",",":"))); return 1
if __name__ == "__main__": raise SystemExit(main())
