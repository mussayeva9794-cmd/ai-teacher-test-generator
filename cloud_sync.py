"""Optional Supabase sync helpers for cloud backup and multi-device access."""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv


load_dotenv()


def is_cloud_enabled() -> bool:
    """Return whether Supabase cloud sync is configured."""
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_KEY"))


def get_client() -> Any:
    """Create a Supabase client if configuration is available."""
    if not is_cloud_enabled():
        raise RuntimeError("Supabase cloud sync is not configured.")

    from supabase import create_client  # Imported lazily because it is optional.

    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_KEY"],
    )


def get_cloud_status() -> dict[str, Any]:
    """Return cloud configuration status."""
    return {
        "enabled": is_cloud_enabled(),
        "url_present": bool(os.getenv("SUPABASE_URL")),
        "key_present": bool(os.getenv("SUPABASE_KEY")),
    }


def sync_history_record(record: dict[str, Any]) -> str:
    """Sync a local history record to Supabase."""
    client = get_client()
    (
        client.table("teacher_test_history")
        .insert(
            {
                "title": record.get("title", ""),
                "topic": record.get("topic", ""),
                "language": record.get("language", ""),
                "difficulty": record.get("difficulty", ""),
                "test_type": record.get("test_type", ""),
                "grade_level": record.get("grade_level", ""),
                "assessment_purpose": record.get("assessment_purpose", ""),
                "source_kind": record.get("source_kind", ""),
                "source_name": record.get("source_name", ""),
                "payload": record.get("payload", {}),
            }
        )
        .execute()
    )
    return "History record synced to Supabase."


def sync_question_bank_item(record: dict[str, Any]) -> str:
    """Sync a question bank entry to Supabase."""
    client = get_client()
    (
        client.table("teacher_question_bank")
        .insert(
            {
                "question_text": record.get("question_text", ""),
                "question_type": record.get("question_type", ""),
                "topic": record.get("topic", ""),
                "skill_tag": record.get("skill_tag", ""),
                "owner_email": record.get("owner_email", ""),
                "payload": record.get("payload", {}),
            }
        )
        .execute()
    )
    return "Question bank item synced to Supabase."


def sync_attempt_result(record: dict[str, Any]) -> str:
    """Sync a student attempt result to Supabase."""
    client = get_client()
    (
        client.table("teacher_attempts")
        .insert(
            {
                "student_name": record.get("student_name", ""),
                "variant_name": record.get("variant_name", ""),
                "test_title": record.get("test_title", ""),
                "percentage": record.get("percentage", 0),
                "owner_email": record.get("owner_email", ""),
                "payload": record.get("payload", {}),
            }
        )
        .execute()
    )
    return "Attempt result synced to Supabase."
