"""Small bounded, single-request-per-connection IPv4 HTTP surface."""

from __future__ import annotations

import json
import socket
import socketserver
import time
from collections import deque
from typing import Callable

from .database import check_database


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic, max_sources: int = 4096) -> None:
        self.clock = clock
        self.max_sources = max_sources
        self.sources: dict[str, deque[float]] = {}
        self.global_events: deque[float] = deque()

    def _trim(self, bucket: deque[float], now: float, window: float) -> None:
        while bucket and bucket[0] <= now - window:
            bucket.popleft()

    def allow(self, source: str, per_window: int, per_limit: int, global_window: int, global_limit: int) -> bool:
        now = self.clock()
        self._trim(self.global_events, now, global_window)
        bucket = self.sources.setdefault(source, deque())
        self._trim(bucket, now, per_window)
        if len(self.sources) > self.max_sources:
            oldest = min(self.sources, key=lambda key: self.sources[key][0] if self.sources[key] else now)
            if oldest != source:
                del self.sources[oldest]
        if len(bucket) >= per_limit or len(self.global_events) >= global_limit:
            return False
        bucket.append(now)
        self.global_events.append(now)
        return True

    def cleanup(self, window: float) -> None:
        now = self.clock()
        self._trim(self.global_events, now, window)
        for source in list(self.sources):
            self._trim(self.sources[source], now, window)
            if not self.sources[source]:
                del self.sources[source]


def _body(data: dict[str, str]) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _response(status: int, data: dict[str, str], retry_after: int | None = None) -> bytes:
    reasons = {200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 413: "Content Too Large", 414: "URI Too Long", 429: "Too Many Requests", 431: "Request Header Fields Too Large", 503: "Service Unavailable"}
    payload = _body(data)
    headers = [f"HTTP/1.1 {status} {reasons.get(status, 'Error')}\r\n", "Content-Type: application/json; charset=utf-8\r\n", "Cache-Control: no-store\r\n", "X-Content-Type-Options: nosniff\r\n", "Connection: close\r\n", f"Content-Length: {len(payload)}\r\n"]
    if retry_after is not None:
        headers.append(f"Retry-After: {retry_after}\r\n")
    return "".join(headers).encode("ascii") + b"\r\n" + payload


class DirectRequestHandler(socketserver.BaseRequestHandler):
    def _send(self, status: int, data: dict[str, str], retry_after: int | None = None) -> None:
        try:
            self.request.sendall(_response(status, data, retry_after))
        except OSError:
            pass

    def handle(self) -> None:
        config = self.server.config  # type: ignore[attr-defined]
        self.request.settimeout(config.request_timeout_seconds)
        try:
            raw = self._read_headers(config.max_header_bytes, config.max_request_line_bytes)
            if raw is None:
                return
            lines = raw.split(b"\r\n")
            if len(lines) < 2 or not lines[0]:
                self._send(400, {"error": "bad_request"})
                return
            if len(lines[0]) > config.max_request_line_bytes:
                self._send(414, {"error": "uri_too_long"})
                return
            parts = lines[0].split(b" ")
            if len(parts) != 3 or parts[2] not in (b"HTTP/1.0", b"HTTP/1.1"):
                self._send(400, {"error": "bad_request"})
                return
            headers: dict[str, str] = {}
            for line in lines[1:-2] if lines[-2:] == [b"", b""] else lines[1:]:
                if not line or b":" not in line:
                    self._send(400, {"error": "bad_request"})
                    return
                key, value = line.split(b":", 1)
                try:
                    name = key.decode("ascii").lower()
                    val = value.strip().decode("latin1")
                except UnicodeDecodeError:
                    self._send(400, {"error": "bad_request"})
                    return
                if not name or name in headers:
                    self._send(400, {"error": "bad_request"})
                    return
                headers[name] = val
            if "content-length" in headers:
                try:
                    length = int(headers["content-length"])
                except ValueError:
                    self._send(400, {"error": "bad_request"})
                    return
                if length < 0:
                    self._send(400, {"error": "bad_request"})
                    return
                if length > config.max_request_body_bytes:
                    self._send(413, {"error": "content_too_large"})
                    return
                remaining = length
                while remaining:
                    chunk = self.request.recv(min(1024, remaining))
                    if not chunk:
                        self._send(400, {"error": "bad_request"})
                        return
                    remaining -= len(chunk)
            limiter = self.server.limiter  # type: ignore[attr-defined]
            if not limiter.allow(self.client_address[0], config.per_source_rate_window_seconds, config.per_source_rate_limit, config.global_rate_window_seconds, config.global_rate_limit):
                self._send(429, {"error": "rate_limited"}, 10)
                return
            if parts[0] != b"GET":
                self._send(405, {"error": "method_not_allowed"})
                return
            target = parts[1].split(b"?", 1)[0]
            service = self.server.service  # type: ignore[attr-defined]
            ready = check_database(service.database_path)
            identity = getattr(service, "identity", None)
            if target == b"/v2/health":
                if ready:
                    self._send(200, {"status": "ok", "service": service.service_name, "version": service.version})
                else:
                    self._send(503, {"status": "unavailable", "service": service.service_name, "version": service.version})
            elif target == b"/v2/version":
                self._send(200, {"service": service.service_name, "version": service.version, "api_version": "v2", "transport": "direct-http-bootstrap"})
            elif target == b"/v2/diagnostics/public":
                self._send(200 if ready else 503, {"service": service.service_name, "version": service.version, "status": "ready" if ready else "unavailable", "listener_scope": "public", "database": "ready" if ready else "unavailable", "identity": "ready" if identity else "unavailable", "pairing": "disabled", "crypto": "disabled", "tasks": "disabled"})
            elif target == b"/v2/bootstrap":
                if not ready or not identity:
                    self._send(503, {"error": "unavailable"})
                else:
                    self._send(200, {"service": service.service_name, "version": service.version, "api_version": "v2", "bootstrap_version": 1, "instance_id": identity["instance_id"], "server_signing_algorithm": identity["signing_algorithm"], "server_public_key_format": identity["public_key_format"], "server_public_key": identity["public_key_spki"], "server_fingerprint": identity["fingerprint"], "rotation_generation": identity["rotation_generation"]})
            else:
                self._send(404, {"error": "not_found"})
        except (socket.timeout, TimeoutError, OSError, UnicodeError):
            return

    def _read_headers(self, maximum: int, line_maximum: int) -> bytes | None:
        data = bytearray()
        while b"\r\n\r\n" not in data:
            chunk = self.request.recv(min(1024, maximum + 1 - len(data)))
            if not chunk:
                return None
            data.extend(chunk)
            if data.find(b"\r\n") >= line_maximum:
                self._send(414, {"error": "uri_too_long"})
                return None
            if len(data) > maximum:
                self._send(431, {"error": "headers_too_large"})
                return None
        head = bytes(data).split(b"\r\n\r\n", 1)[0]
        if len(head) > maximum:
            self._send(431, {"error": "headers_too_large"})
            return None
        if len(head.split(b"\r\n")) - 1 > 32:
            self._send(431, {"error": "too_many_headers"})
            return None
        return head + b"\r\n\r\n"


class BoundedIPv4Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    address_family = socket.AF_INET
    allow_reuse_address = False
    daemon_threads = True
    block_on_close = True

    def __init__(self, address: tuple[str, int], service: object, config: object) -> None:
        self.config = config
        self.service = service
        self.limiter = RateLimiter()
        self._slots = __import__("threading").BoundedSemaphore(config.max_concurrent_requests)
        self.request_queue_size = config.listen_backlog
        super().__init__(address, DirectRequestHandler)

    def process_request(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        if not self._slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(_response(503, {"error": "concurrency_limited"}))
                request.close()
            except OSError:
                pass
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request: socket.socket, client_address: tuple[str, int]) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()
