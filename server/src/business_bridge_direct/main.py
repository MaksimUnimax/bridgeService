"""Process entrypoint for the isolated bounded public Direct service."""

from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
from datetime import datetime, timezone

from . import __version__
from .config import DirectConfig, load_config
from .database import initialize_database


def _event(level: str, event: str, result: str) -> None:
    print(json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(), "level": level, "event": event, "service": "business-bridge-2-direct", "version": __version__, "result": result}, separators=(",", ":")), file=sys.stderr, flush=True)


class DirectService:
    def __init__(self, config: DirectConfig) -> None:
        self.database_path = config.database_path
        self.service_name = config.service_name
        self.version = config.service_version
        from .http_api import BoundedIPv4Server
        self.server = BoundedIPv4Server((config.listen_host, config.listen_port), self, config)

    def run(self) -> None:
        stopping = {"value": False}

        def stop(_signum: int, _frame: object) -> None:
            if not stopping["value"]:
                stopping["value"] = True
                threading.Thread(target=self.server.shutdown, name="direct-shutdown", daemon=True).start()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        _event("INFO", "service_started", "ok")
        try:
            self.server.serve_forever(poll_interval=0.1)
        finally:
            self.server.server_close()
            _event("INFO", "service_stopped", "ok")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", required=True)
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        initialize_database(config.database_path)
        service = DirectService(config)
        service.run()
        return 0
    except Exception:
        _event("ERROR", "service_failed", "error")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
