"""Explicit, non-startup identity provisioning and verification entrypoint."""
from __future__ import annotations
import argparse, grp, json
from .config import load_config
from .identity import IdentityError, init_identity, validate_identity

def main(argv=None) -> int:
    p=argparse.ArgumentParser(); p.add_argument("command", choices=("init","verify")); p.add_argument("--config", required=True); a=p.parse_args(argv)
    try:
        cfg=load_config(a.config); gid=grp.getgrnam("business-bridge-direct").gr_gid
        data, result = init_identity(cfg, gid) if a.command == "init" else (validate_identity(cfg, gid), "verified")
        print(json.dumps({"status":"ok","result":result,"instance_id":data["instance_id"],"fingerprint":data["fingerprint"]}, separators=(",",":")))
        return 0
    except (IdentityError, ValueError, OSError, KeyError):
        print(json.dumps({"status":"error","error":"identity_validation_failed"}, separators=(",",":")))
        return 1

if __name__ == "__main__": raise SystemExit(main())
