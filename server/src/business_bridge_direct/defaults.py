"""Configuration values reserved for Direct runtime activation.

This module only describes paths and network settings. Importing it does not
read configuration, create directories, open sockets, access a database, or
start a process.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class DirectDefaults:
    install_dir: str = "/opt/business-bridge-2-direct"
    config_dir: str = "/etc/business-bridge-2-direct"
    secrets_dir: str = "/etc/business-bridge-2-direct/secrets"
    state_dir: str = "/var/lib/business-bridge-2-direct"
    database_path: str = "/var/lib/business-bridge-2-direct/bridge.sqlite3"
    log_dir: str = "/var/log/business-bridge-2-direct"
    service_name: str = "business-bridge-2-direct.service"
    service_user: str = "business-bridge-direct"
    listen_host: str = "78.17.68.165"
    listen_port: int = 18100
    service_version: str = "0.5.0"
    identity_metadata_path: str = "/var/lib/business-bridge-2-direct/identity/identity.json"
    server_signing_private_key_path: str = "/etc/business-bridge-2-direct/secrets/server_signing_private_key.pem"
    openssl_path: str = "/usr/bin/openssl"


DEFAULTS = DirectDefaults()
