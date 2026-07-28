"""Strict, secret-free configuration for the localhost Direct service."""

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


_FIELDS = {"listen_host", "listen_port", "database_path", "log_dir", "service_name", "service_version"}


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
    if not isinstance(data["listen_host"], str) or data["listen_host"] != DEFAULTS.listen_host:
        raise ValueError("non-local bind")
    if type(data["listen_port"]) is not int or not 1 <= data["listen_port"] <= 65535:
        raise ValueError("invalid port")
    if not isinstance(data["database_path"], str) or not _inside(Path(data["database_path"]), Path(DEFAULTS.state_dir)):
        raise ValueError("foreign database path")
    if not isinstance(data["log_dir"], str) or Path(data["log_dir"]).resolve() != Path(DEFAULTS.log_dir).resolve():
        raise ValueError("foreign log path")
    if not all(isinstance(data[key], str) for key in ("service_name", "service_version")):
        raise ValueError("invalid config types")
    if data["service_name"] != "business-bridge-2-direct" or data["service_version"] != __version__:
        raise ValueError("invalid service identity")
    return DirectConfig(**data)
