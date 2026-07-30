from __future__ import annotations
import inspect
import unittest
from acceptance_clients import HTTPTransport, PairingClient, SessionClient, TaskClient, TaskAcceptanceScenario


class AcceptanceArchitectureTests(unittest.TestCase):
    def test_three_endpoint_clients_have_exact_paths(self):
        self.assertEqual(PairingClient.PATH, "/v2/pairing/complete")
        self.assertEqual(SessionClient.PATH, "/v2/protocol/session")
        self.assertEqual(TaskClient.PATH, "/v2/protocol/tasks")

    def test_transport_is_payload_agnostic(self):
        source = inspect.getsource(HTTPTransport)
        for forbidden in ("pairing_code", "ciphertext", "SESSION_FIELDS", "ENV_FIELDS"):
            self.assertNotIn(forbidden, source)

    def test_scenario_only_orchestrates_clients(self):
        source = inspect.getsource(TaskAcceptanceScenario)
        for forbidden in ("canonical(", "json.dumps", "socket.", "ciphertext", "signature"):
            self.assertNotIn(forbidden, source)
        self.assertIn("self.pairing.complete", source)
        self.assertIn("self.session.open", source)
        self.assertIn("self.tasks.send", source)

    def test_task_client_owns_task_path_and_protected_building(self):
        source = inspect.getsource(TaskClient)
        self.assertIn("/v2/protocol/tasks", source)
        self.assertIn("ENV_FIELDS", source)
        self.assertIn("aes_encrypt", source)
        self.assertNotIn("pairing/complete", source)
        self.assertNotIn("protocol/session", source)


if __name__ == "__main__":
    unittest.main()
