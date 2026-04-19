import tempfile
import unittest
from pathlib import Path

import storage


class StorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        storage.DB_PATH = Path(self.tempdir.name) / "test.db"
        storage.initialize_database()

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_user_creation_and_authentication(self) -> None:
        ok, message = storage.create_local_user("teacher@example.com", "StrongPass1", "Teacher", "teacher")
        self.assertTrue(ok, message)
        user = storage.authenticate_local_user("teacher@example.com", "StrongPass1")
        self.assertIsNotNone(user)
        self.assertEqual(user["role"], "teacher")

    def test_schema_and_audit_usage(self) -> None:
        storage.log_audit_event("teacher@example.com", "teacher", "sign_in", "user", "teacher@example.com", {})
        storage.record_usage_event("teacher@example.com", "generation", 1, {"topic": "Math"})
        plan = storage.get_plan_status("teacher@example.com")
        self.assertIn("limits", plan)
        self.assertTrue(storage.list_audit_logs(limit=10))
        self.assertTrue(storage.list_usage_events(limit=10))

    def test_email_validation(self) -> None:
        self.assertTrue(storage.is_valid_email("student@example.com"))
        self.assertFalse(storage.is_valid_email("wrong-email"))


if __name__ == "__main__":
    unittest.main()
