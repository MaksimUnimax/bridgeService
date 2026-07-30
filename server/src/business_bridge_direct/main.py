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
from .identity import IdentityError, validate_identity


def _event(level: str, event: str, result: str) -> None:
    print(json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(), "level": level, "event": event, "service": "business-bridge-2-direct", "version": __version__, "result": result}, separators=(",", ":")), file=sys.stderr, flush=True)


class DirectService:
    def __init__(self, config: DirectConfig) -> None:
        self.config = config
        self.database_path = config.database_path
        self.service_name = config.service_name
        self.version = config.service_version
        import grp
        self.identity = validate_identity(config, grp.getgrnam("business-bridge-direct").gr_gid)
        from .protocol import Protocol
        self.protocol = Protocol(self)
        from .http_api import BoundedIPv4Server
        self.server = BoundedIPv4Server((config.listen_host, config.listen_port), self, config)
        from .worker import DurableWorker
        self.stop_event = threading.Event()
        self.worker = DurableWorker(self.database_path, self.stop_event)

    def run(self) -> None:
        stopping = {"value": False}

        def stop(_signum: int, _frame: object) -> None:
            if not stopping["value"]:
                stopping["value"] = True
                self.stop_event.set()
                threading.Thread(target=self.server.shutdown, name="direct-shutdown", daemon=True).start()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        _event("INFO", "service_started", "ok")
        try:
            self.worker.start()
            self.server.serve_forever(poll_interval=0.1)
        finally:
            self.stop_event.set()
            self.worker.join(5.0)
            self.server.server_close()
            _event("INFO", "service_stopped", "ok")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", required=True)
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        initialize_database(config.database_path)
        from .tasks import recover
        recover(config.database_path)
        service = DirectService(config)
        service.run()
        return 0
    except Exception:
        _event("ERROR", "service_failed", "error")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
