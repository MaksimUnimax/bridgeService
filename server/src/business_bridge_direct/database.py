"""Minimal Direct runtime metadata database."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1


def initialize_database(path: str) -> None:
    database = Path(path)
    if database.is_symlink() or (database.exists() and not database.is_file()):
        raise ValueError("invalid database file")
    database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database)
    try:
        connection.execute("PRAGMA user_version = 1")
        connection.execute("CREATE TABLE IF NOT EXISTS runtime_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("INSERT OR REPLACE INTO runtime_metadata(key, value) VALUES (?, ?)", ("schema_version", "1"))
        connection.execute("INSERT OR REPLACE INTO runtime_metadata(key, value) VALUES (?, ?)", ("service_version", "0.2.0"))
        connection.commit()
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version != SCHEMA_VERSION:
            raise RuntimeError("invalid database schema")
    finally:
        connection.close()
    os.chmod(database, 0o600)


def check_database(path: str) -> bool:
    try:
        database = Path(path)
        if database.is_symlink() or not database.is_file():
            return False
        connection = sqlite3.connect(database, timeout=0.2)
        try:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            table = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_metadata'").fetchone()
            rows = dict(connection.execute("SELECT key, value FROM runtime_metadata").fetchall()) if table else {}
            connection.execute("SELECT 1")
            return version == SCHEMA_VERSION and table is not None and rows.get("schema_version") == "1" and rows.get("service_version") == "0.2.0"
        finally:
            connection.close()
    except (OSError, sqlite3.Error, ValueError):
        return False
