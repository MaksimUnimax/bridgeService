"""Small HTTP/1.1 API with a deliberately narrow public surface."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from .database import check_database


def _json(handler: BaseHTTPRequestHandler, status: int, body: dict[str, str]) -> None:
    payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


class DirectRequestHandler(BaseHTTPRequestHandler):
    server_version = "BusinessBridgeDirect"
    sys_version = ""

    def log_message(self, *_args: object) -> None:
        return

    def do_GET(self) -> None:
        self._dispatch()

    def do_POST(self) -> None:
        self._dispatch()

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST

    def _dispatch(self) -> None:
        path = urlsplit(self.path).path
        if self.command != "GET":
            _json(self, 405, {"error": "method_not_allowed"})
            return
        service = self.server.direct_service  # type: ignore[attr-defined]
        if path == "/v2/health":
            if check_database(service.database_path):
                _json(self, 200, {"status": "ok", "service": service.service_name, "version": service.version})
            else:
                _json(self, 503, {"status": "unavailable", "service": service.service_name, "version": service.version})
        elif path == "/v2/version":
            _json(self, 200, {"service": service.service_name, "version": service.version, "api_version": "v2", "transport": "localhost-http"})
        elif path == "/v2/diagnostics/public":
            status = "ready" if check_database(service.database_path) else "unavailable"
            _json(self, 200 if status == "ready" else 503, {"service": service.service_name, "version": service.version, "status": status, "listener_scope": "localhost", "database": "ready" if status == "ready" else "unavailable", "identity": "not_configured", "pairing": "disabled", "crypto": "disabled", "tasks": "disabled"})
        else:
            _json(self, 404, {"error": "not_found"})


class DirectHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True
    block_on_close = True

    def __init__(self, address: tuple[str, int], service: object) -> None:
        super().__init__(address, DirectRequestHandler)
        self.direct_service = service
