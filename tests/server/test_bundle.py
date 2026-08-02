from __future__ import annotations

import base64
import ast
import ipaddress
import json
import re
import sqlite3
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest import mock

import business_bridge_direct
from business_bridge_direct import bundle as prod
from business_bridge_direct import database as db
from business_bridge_direct.tasks import create


FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "BB2D1_BUNDLE_VECTORS.json"
SYNTETIC_SPKI = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdajsc0MKWPGn8JlAvd1iQTED8wgDHYF23Heq1sM-5eL61zFhKHewF9HoMsE3GCD2-ZOUa3z5XJS4rpGU9yCC0g"
SYNTETIC_FINGERPRINT = "sha256:10a517a54a7fa625a2e46ad219e423e9e185b50c5b270c0e1755d457f2ce0fab"


class BundleError(ValueError):
    pass


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise BundleError("duplicate_json_key")
        result[key] = value
    return result


def _strict_b64url_decode(value: object) -> bytes:
    if not isinstance(value, str) or not value or "=" in value or any(ch in value for ch in "\r\n"):
        raise BundleError("invalid_bundle")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise BundleError("invalid_bundle")
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise BundleError("invalid_bundle") from exc
    if base64.urlsafe_b64encode(decoded).decode().rstrip("=") != value:
        raise BundleError("invalid_bundle")
    return decoded


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise BundleError("invalid_bundle")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception as exc:
        raise BundleError("invalid_bundle") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0) or parsed.microsecond != 0:
        raise BundleError("invalid_bundle")
    if parsed.isoformat(timespec="seconds").replace("+00:00", "Z") != value:
        raise BundleError("invalid_bundle")
    return parsed


def _uuid4(value: object) -> str:
    if not isinstance(value, str) or value != value.lower():
        raise BundleError("invalid_bundle")
    try:
        parsed = uuid.UUID(value)
    except Exception as exc:
        raise BundleError("invalid_bundle") from exc
    if parsed.version != 4 or str(parsed) != value:
        raise BundleError("invalid_bundle")
    return value


def _ipv4(value: object) -> str:
    if not isinstance(value, str):
        raise BundleError("invalid_bundle")
    try:
        addr = ipaddress.IPv4Address(value)
    except Exception as exc:
        raise BundleError("invalid_bundle") from exc
    if str(addr) != value:
        raise BundleError("invalid_bundle")
    return value


def _canonical_bytes(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")


def _validate_payload(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise BundleError("invalid_bundle")
    expected = {
        "bundle_version",
        "expires_at",
        "host",
        "instance_id",
        "issued_at",
        "pairing_code",
        "pairing_session_id",
        "port",
        "rotation_generation",
        "server_fingerprint",
        "server_public_key",
        "server_public_key_format",
        "server_signing_algorithm",
    }
    if set(payload) != expected:
        raise BundleError("invalid_bundle")
    issued_at = _timestamp(payload["issued_at"])
    expires_at = _timestamp(payload["expires_at"])
    if expires_at <= issued_at:
        raise BundleError("invalid_bundle")
    ttl = int((expires_at - issued_at).total_seconds())
    if timedelta(seconds=ttl) != expires_at - issued_at or ttl < 300 or ttl > 600:
        raise BundleError("invalid_bundle")
    if payload["bundle_version"] != "BB2D1":
        raise BundleError("invalid_bundle")
    if payload["server_signing_algorithm"] != "ECDSA_P256_SHA256":
        raise BundleError("invalid_bundle")
    if payload["server_public_key_format"] != "SPKI_DER_BASE64URL":
        raise BundleError("invalid_bundle")
    server_public_key = _strict_b64url_decode(payload["server_public_key"])
    if not 50 <= len(server_public_key) <= 512:
        raise BundleError("invalid_bundle")
    if payload["server_fingerprint"] != "sha256:" + __import__("hashlib").sha256(server_public_key).hexdigest():
        raise BundleError("invalid_bundle")
    return {
        "bundle_version": payload["bundle_version"],
        "expires_at": payload["expires_at"],
        "host": _ipv4(payload["host"]),
        "instance_id": _uuid4(payload["instance_id"]),
        "issued_at": payload["issued_at"],
        "pairing_code": payload["pairing_code"] if isinstance(payload["pairing_code"], str) and re.fullmatch(r"[0-9a-f]{32}", payload["pairing_code"]) else (_ for _ in ()).throw(BundleError("invalid_bundle")),
        "pairing_session_id": _uuid4(payload["pairing_session_id"]),
        "port": payload["port"] if type(payload["port"]) is int and 1 <= payload["port"] <= 65535 else (_ for _ in ()).throw(BundleError("invalid_bundle")),
        "rotation_generation": payload["rotation_generation"] if type(payload["rotation_generation"]) is int and payload["rotation_generation"] >= 1 else (_ for _ in ()).throw(BundleError("invalid_bundle")),
        "server_fingerprint": payload["server_fingerprint"] if isinstance(payload["server_fingerprint"], str) and re.fullmatch(r"sha256:[0-9a-f]{64}", payload["server_fingerprint"]) else (_ for _ in ()).throw(BundleError("invalid_bundle")),
        "server_public_key": payload["server_public_key"],
        "server_public_key_format": payload["server_public_key_format"],
        "server_signing_algorithm": payload["server_signing_algorithm"],
    }


def reference_decode(bundle_line: str, *, now: str | datetime | None = None) -> dict[str, object]:
    if not isinstance(bundle_line, str):
        raise TypeError("bundle_must_be_str")
    if not bundle_line or len(bundle_line) > 4096 or any(ch in bundle_line for ch in "\r\n") or any(ch.isspace() for ch in bundle_line):
        raise BundleError("invalid_bundle")
    parts = bundle_line.split(".")
    if len(parts) != 3 or parts[0] != "BB2D1":
        raise BundleError("invalid_bundle")
    payload_bytes = _strict_b64url_decode(parts[1])
    checksum_bytes = _strict_b64url_decode(parts[2])
    if len(checksum_bytes) != 32 or len(parts[2]) != 43:
        raise BundleError("invalid_bundle")
    expected = __import__("hashlib").sha256(b"BB2D1\x00" + payload_bytes).digest()
    if checksum_bytes != expected:
        raise BundleError("invalid_bundle")
    try:
        payload = json.loads(payload_bytes.decode("utf-8"), object_pairs_hook=_pairs)
    except Exception as exc:
        raise BundleError("invalid_bundle") from exc
    validated = _validate_payload(payload)
    if _canonical_bytes(validated) != payload_bytes:
        raise BundleError("invalid_bundle")
    if now is not None:
        validator_now = _timestamp(now) if isinstance(now, str) else now
        if validator_now.tzinfo is None:
            validator_now = validator_now.replace(tzinfo=timezone.utc)
        if _timestamp(validated["expires_at"]) <= validator_now.astimezone(timezone.utc).replace(microsecond=0):
            raise BundleError("expired_bundle")
    return validated


class BundleVectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_positive_vector_round_trip(self) -> None:
        positive = self.fixture["positive"]
        payload = positive["decoded_object"]
        encoded = prod.encode_bundle(payload)
        self.assertEqual(encoded, positive["expected_bundle"])
        self.assertEqual(encoded.count("."), 2)
        self.assertTrue(encoded.startswith("BB2D1."))
        self.assertNotIn("=", encoded)
        self.assertLessEqual(len(encoded) + 1, 4096)
        self.assertEqual(prod.canonical_payload_bytes(payload).hex(), positive["payload_hex"])
        self.assertEqual(prod.checksum_domain_bytes(bytes.fromhex(positive["payload_hex"])).hex(), positive["checksum_domain_input_hex"])
        self.assertEqual(__import__("hashlib").sha256(prod.checksum_domain_bytes(bytes.fromhex(positive["payload_hex"]))).hexdigest(), positive["checksum_sha256_hex"])
        self.assertEqual(prod.validate_payload(payload), payload)
        prod.validate_checksum(bytes.fromhex(positive["payload_hex"]), bytes.fromhex(positive["checksum_sha256_hex"]))
        self.assertIsInstance(prod.validate_server_public_key(payload["server_public_key"], payload["server_fingerprint"]), bytes)
        self.assertEqual(prod.decode_bundle(encoded, now=positive["decoded_object"]["issued_at"]), payload)
        self.assertEqual(reference_decode(encoded, now=positive["decoded_object"]["issued_at"]), payload)

    def test_negative_vectors(self) -> None:
        for vector in self.fixture["negative"]:
            with self.subTest(case=vector["case"]):
                for decoder in (prod.decode_bundle, reference_decode):
                    with self.assertRaises(Exception) as cm:
                        if "now" in vector:
                            decoder(vector["bundle"], now=vector["now"])
                        else:
                            decoder(vector["bundle"])
                    self.assertEqual(type(cm.exception).__name__, vector["expected_error_class"])

    def test_decoder_static_purity_forbids_side_effect_dependencies(self) -> None:
        source = (Path(prod.__file__)).read_text(encoding="utf-8")
        tree = ast.parse(source)
        forbidden = {"os", "subprocess", "tempfile", "socket", "pathlib", "logging", "sqlite3"}
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
        self.assertTrue(forbidden.isdisjoint(imported))
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                self.assertNotIn(node.id, {"open", "Popen", "run", "TemporaryDirectory"})

    def test_decoder_dynamic_purity_on_invalid_untrusted_der(self) -> None:
        with mock.patch("subprocess.run") as run, mock.patch("subprocess.Popen") as popen, mock.patch("builtins.open") as open_file, mock.patch("os.getenv") as getenv, mock.patch("socket.socket") as socket_ctor:
            with self.assertRaises(prod.BundleError):
                prod.validate_server_public_key("A" * 68, "sha256:" + "0" * 64)
        run.assert_not_called(); popen.assert_not_called(); open_file.assert_not_called(); getenv.assert_not_called(); socket_ctor.assert_not_called()

    def test_spki_crypto_validation_is_strict(self) -> None:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec, rsa
        valid = serialization.load_der_public_key(base64.urlsafe_b64decode(SYNTETIC_SPKI + "=" * (-len(SYNTETIC_SPKI) % 4)))
        self.assertIsNotNone(valid)
        self.assertIsInstance(prod.validate_server_public_key(SYNTETIC_SPKI, SYNTETIC_FINGERPRINT), bytes)
        cases = [
            (b"not-der", "invalid DER"),
            (rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key(), "RSA"),
            (ec.generate_private_key(ec.SECP384R1()).public_key(), "wrong curve"),
        ]
        for key, _label in cases:
            if not isinstance(key, bytes):
                key = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
            encoded = base64.urlsafe_b64encode(key).decode().rstrip("=")
            with self.assertRaises(prod.BundleError):
                prod.validate_server_public_key(encoded, "sha256:" + __import__("hashlib").sha256(key).hexdigest())
        with self.assertRaises(prod.BundleError):
            prod.validate_server_public_key(SYNTETIC_SPKI, "sha256:" + "0" * 64)

    def test_duplicate_task_survives_version_upgrade(self) -> None:
        owner = "00000000-0000-4000-8000-000000000002"
        session_id = "00000000-0000-4000-8000-000000000001"
        request = {
            "type": "task_create",
            "operation_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "execution_mode": "remain_pending",
            "task_payload": {"subject": "stable"},
        }
        with tempfile.TemporaryDirectory() as directory:
            db_path = str(Path(directory) / "bridge.sqlite3")
            db.initialize_database(db_path)
            with sqlite3.connect(db_path) as connection:
                connection.execute("UPDATE runtime_metadata SET value='0.8.0' WHERE key='service_version'")
                connection.execute(
                    "INSERT INTO pairing_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (session_id, b"s", b"v", "2026-07-30T00:00:00Z", "2026-07-30T00:10:00Z", 0, 5, "CONSUMED", "2026-07-30T00:00:00Z", owner, None),
                )
                connection.execute(
                    "INSERT INTO paired_devices VALUES (?,?,?,?,?,?,?)",
                    (owner, "pub", "fp", "2026-07-30T00:00:00Z", "ACTIVE", None, session_id),
                )
                connection.commit()
            first, first_error = create(db_path, owner, request)
            self.assertIsNone(first_error)
            with mock.patch.object(business_bridge_direct, "__version__", "0.9.0"), mock.patch.object(db, "SERVICE_VERSION", "0.9.0"):
                with sqlite3.connect(db_path) as connection:
                    connection.execute("UPDATE runtime_metadata SET value='0.9.0' WHERE key='service_version'")
                    connection.commit()
                second, second_error = create(db_path, owner, request)
                self.assertIsNone(second_error)
                self.assertEqual((first["task_id"], first["operation_id"]), (second["task_id"], second["operation_id"]))
                _, conflict = create(db_path, owner, {**request, "operation_id": request["operation_id"], "task_payload": {"subject": "changed"}})
                self.assertEqual(conflict, "operation_payload_conflict")
