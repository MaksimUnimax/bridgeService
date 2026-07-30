from __future__ import annotations

import inspect
import unittest

from task_acceptance_client import AcceptanceClient, MUTATORS, CallableTransport


class TaskAcceptanceClientContractTests(unittest.TestCase):
    def test_complete_contract_is_executable_without_network(self):
        builders = (
            "task_create_immediate", "task_create_pending", "equivalent_duplicate_create",
            "reordered_payload_duplicate_create", "different_payload_conflict_create", "task_status",
            "task_cancel", "repeated_cancel", "task_report", "repeated_report", "unknown_task_status",
            "unknown_task_report", "authenticated_invalid_application_request",
        )
        for name in builders:
            self.assertTrue(callable(getattr(AcceptanceClient, name)), name)
        for name in MUTATORS:
            self.assertTrue(callable(getattr(AcceptanceClient, "mutate")), name)
        source = inspect.getsource(AcceptanceClient)
        self.assertEqual(source.count("self._validate_request(raw)"), 2)
        self.assertIn("self._validate_response", source)
        self.assertIn("class SocketTransport", inspect.getsource(__import__("task_acceptance_client").SocketTransport))
        self.assertIn("class CallableTransport", inspect.getsource(CallableTransport))
        self.assertNotIn("78.17.68.165", source)
        self.assertNotIn("/etc/business-bridge-2-direct", source)
        self.assertNotIn("/var/lib/business-bridge-2-direct", source)

    def test_self_validation_rejects_malformed_envelopes_before_adapter(self):
        sent = []
        client = AcceptanceClient(CallableTransport(lambda body: sent.append(body)))
        client.session_id = "00000000-0000-4000-8000-000000000001"
        client.device_id = "00000000-0000-4000-8000-000000000002"
        client.c2s = b"0" * 32; client.s2c = b"1" * 32
        for mutation in ("extra_outer_field", "missing_outer_field", "malformed_base64url", "stale_timestamp", "future_timestamp_outside_window"):
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                client.mutate(mutation)
        self.assertEqual(sent, [])

    def test_transport_adapters_do_not_construct_envelopes(self):
        for adapter in (CallableTransport,):
            source = inspect.getsource(adapter)
            self.assertNotIn("protocol_version", source)
            self.assertNotIn("ciphertext", source)
            self.assertNotIn("signature", source)


if __name__ == "__main__":
    unittest.main()
