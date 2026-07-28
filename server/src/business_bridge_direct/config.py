"""Strict, secret-free configuration for the bounded Direct listener."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from . import __version__
from .defaults import DEFAULTS


@dataclass(frozen=True)
class DirectConfig:
    listen_host: str
    listen_port: int
    database_path: str
    log_dir: str
    service_name: str
    service_version: str
    request_timeout_seconds: int
    max_request_line_bytes: int
    max_header_bytes: int
    max_header_count: int
    max_request_body_bytes: int
    max_concurrent_requests: int
    listen_backlog: int
    per_source_rate_window_seconds: int
    per_source_rate_limit: int
    global_rate_window_seconds: int
    global_rate_limit: int
    identity_metadata_path: str
    server_signing_private_key_path: str
    openssl_path: str


_FIELDS = {"listen_host", "listen_port", "database_path", "log_dir", "service_name", "service_version", "identity_metadata_path", "server_signing_private_key_path", "openssl_path", "request_timeout_seconds", "max_request_line_bytes", "max_header_bytes", "max_header_count", "max_request_body_bytes", "max_concurrent_requests", "listen_backlog", "per_source_rate_window_seconds", "per_source_rate_limit", "global_rate_window_seconds", "global_rate_limit"}
_LIMITS = {
    "request_timeout_seconds": (1, 5), "max_request_line_bytes": (512, 2048),
    "max_header_bytes": (2048, 8192), "max_header_count": (8, 32),
    "max_request_body_bytes": (256, 4096), "max_concurrent_requests": (1, 16),
    "listen_backlog": (1, 32), "per_source_rate_window_seconds": (1, 10),
    "per_source_rate_limit": (1, 30), "global_rate_window_seconds": (1, 10),
    "global_rate_limit": (1, 120),
}


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def load_config(path: str | os.PathLike[str]) -> DirectConfig:
    config_path = Path(path)
    if config_path.is_symlink() or not config_path.is_file():
        raise ValueError("invalid config file")
    if config_path.stat().st_mode & 0o002:
        raise ValueError("unsafe config permissions")
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError("invalid config") from exc
    if not isinstance(data, dict) or set(data) != _FIELDS:
        raise ValueError("invalid config fields")
    if not isinstance(data["listen_host"], str) or data["listen_host"] not in {"78.17.68.165", "0.0.0.0"}:
        raise ValueError("unsupported IPv4 bind")
    if type(data["listen_port"]) is not int or data["listen_port"] != 18100:
        raise ValueError("invalid port")
    if not isinstance(data["database_path"], str) or not _inside(Path(data["database_path"]), Path(DEFAULTS.state_dir)) or Path(data["database_path"]).is_symlink():
        raise ValueError("foreign database path")
    if not isinstance(data["log_dir"], str) or Path(data["log_dir"]).resolve() != Path(DEFAULTS.log_dir).resolve():
        raise ValueError("foreign log path")
    identity_path = Path(data["identity_metadata_path"])
    identity_dir = Path(DEFAULTS.state_dir) / "identity"
    if data["identity_metadata_path"] != DEFAULTS.identity_metadata_path or identity_path.parent != identity_dir or not identity_path.is_absolute() or identity_path.is_symlink() or identity_path.parent.is_symlink():
        raise ValueError("foreign identity path")
    if data["server_signing_private_key_path"] != DEFAULTS.server_signing_private_key_path or not _inside(Path(data["server_signing_private_key_path"]), Path(DEFAULTS.secrets_dir)):
        raise ValueError("foreign secrets path")
    openssl = Path(data["openssl_path"])
    if not openssl.is_absolute() or openssl.is_symlink() or not openssl.is_file() or not os.access(openssl, os.X_OK):
        raise ValueError("invalid openssl executable")
    st = openssl.stat()
    if st.st_uid != 0 or st.st_mode & 0o022:
        raise ValueError("unsafe openssl executable")
    if not all(isinstance(data[key], str) for key in ("service_name", "service_version")):
        raise ValueError("invalid config types")
    if data["service_name"] != "business-bridge-2-direct" or data["service_version"] != __version__:
        raise ValueError("invalid service identity")
    for key, (minimum, maximum) in _LIMITS.items():
        if type(data[key]) is not int or not minimum <= data[key] <= maximum:
            raise ValueError("invalid limit")
    return DirectConfig(**data)
