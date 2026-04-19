"""Supabase data-layer helpers for cloud-first storage with SQLite fallback."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - optional dependency for test environments
    def load_dotenv() -> None:
        return


load_dotenv()


def is_cloud_enabled() -> bool:
    """Return whether Supabase cloud storage is configured."""
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_KEY"))


def get_client() -> Any:
    """Create a Supabase client if configuration is available."""
    if not is_cloud_enabled():
        raise RuntimeError("Supabase cloud storage is not configured.")

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


def _result_data(response: Any) -> list[dict[str, Any]]:
    """Normalize Supabase result payload."""
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


def _first_row(response: Any) -> dict[str, Any] | None:
    """Return the first row from a Supabase response."""
    rows = _result_data(response)
    return rows[0] if rows else None


def _hash_password(password: str, salt: str | None = None) -> str:
    """Hash a password with PBKDF2."""
    salt = salt or secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000,
    ).hex()
    return f"{salt}${password_hash}"


def _verify_password(password: str, stored_value: str) -> bool:
    """Verify a password against a stored hash."""
    try:
        salt, expected_hash = stored_value.split("$", 1)
    except ValueError:
        return False
    actual_hash = _hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(actual_hash, expected_hash)


def create_cloud_user(email: str, password: str, display_name: str, role: str) -> tuple[bool, str]:
    """Create a cloud-backed local-style user in Supabase."""
    client = get_client()
    email = email.strip().lower()
    display_name = display_name.strip()
    role = role.strip().lower()
    if not email or not password or not display_name:
        return False, "Email, password, and display name are required."
    if role not in {"teacher", "student"}:
        return False, "Role must be teacher or student."

    existing = _result_data(
        client.table("app_users").select("email").eq("email", email).limit(1).execute()
    )
    if existing:
        return False, "A user with this email already exists."

    client.table("app_users").insert(
        {
            "email": email,
            "display_name": display_name,
            "password_hash": _hash_password(password),
            "role": role,
            "auth_provider": "local",
            "auth_user_id": "",
            "plan_name": "trial" if role == "teacher" else "student",
            "account_status": "active",
            "trial_ends_at": "" if role == "student" else (datetime.now(UTC) + timedelta(days=14)).replace(microsecond=0).isoformat(),
        }
    ).execute()
    return True, "Profile created successfully."


def authenticate_cloud_user(email: str, password: str) -> dict[str, Any] | None:
    """Authenticate a Supabase-backed user profile."""
    client = get_client()
    email = email.strip().lower()
    rows = _result_data(
        client.table("app_users")
        .select("email,display_name,password_hash,role,plan_name,account_status,trial_ends_at")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    if not rows:
        return None
    row = rows[0]
    if not _verify_password(password, str(row.get("password_hash", ""))):
        return None
    return {
        "email": row.get("email", ""),
        "display_name": row.get("display_name", ""),
        "role": row.get("role", ""),
        "plan_name": row.get("plan_name", "free"),
        "account_status": row.get("account_status", "active"),
        "trial_ends_at": row.get("trial_ends_at", ""),
    }


def save_cloud_test_record(record: dict[str, Any]) -> int:
    """Insert one test snapshot into Supabase and return its id."""
    client = get_client()
    response = client.table("teacher_test_history").insert(record).execute()
    rows = _result_data(response)
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def update_cloud_autosave_record(record_id: int, record: dict[str, Any]) -> int:
    """Update an existing autosave snapshot."""
    client = get_client()
    client.table("teacher_test_history").update(record).eq("id", record_id).execute()
    return int(record_id)


def find_cloud_autosave_record(test_uid: str, owner_email: str) -> dict[str, Any] | None:
    """Return the latest autosave snapshot row for this test."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_test_history")
        .select("*")
        .eq("test_uid", test_uid)
        .eq("owner_email", owner_email)
        .eq("is_autosave", True)
        .order("id", desc=True)
        .limit(1)
        .execute()
    )
    return rows[0] if rows else None


def list_cloud_test_history(limit: int = 20, owner_email: str | None = None) -> list[dict[str, Any]]:
    """Return recent history entries from Supabase."""
    client = get_client()
    query = client.table("teacher_test_history").select("*").order("updated_at", desc=True).limit(limit)
    if owner_email:
        query = query.eq("owner_email", owner_email)
    return _result_data(query.execute())


def list_cloud_test_library(
    *,
    owner_email: str,
    search: str = "",
    language: str = "",
    grade_level: str = "",
    topic: str = "",
    subject_tag: str = "",
    include_archived: bool = False,
    favorites_only: bool = False,
    sort_by: str = "updated_desc",
) -> list[dict[str, Any]]:
    """Return latest non-autosave test snapshots per test_uid from Supabase."""
    rows = list_cloud_test_history(limit=1000, owner_email=owner_email)
    latest_by_uid: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("is_autosave"):
            continue
        test_uid = str(row.get("test_uid", "")).strip()
        if not test_uid or test_uid in latest_by_uid:
            continue
        latest_by_uid[test_uid] = row

    items = list(latest_by_uid.values())
    if not include_archived:
        items = [item for item in items if not bool(item.get("archived"))]
    if search.strip():
        search_lower = search.strip().lower()
        items = [
            item
            for item in items
            if search_lower in str(item.get("title", "")).lower()
            or search_lower in str(item.get("topic", "")).lower()
            or search_lower in str(item.get("source_name", "")).lower()
        ]
    if language:
        items = [item for item in items if item.get("language") == language]
    if grade_level:
        items = [item for item in items if item.get("grade_level") == grade_level]
    if topic.strip():
        topic_lower = topic.strip().lower()
        items = [item for item in items if topic_lower in str(item.get("topic", "")).lower()]
    if subject_tag.strip():
        tag_lower = subject_tag.strip().lower()
        items = [item for item in items if tag_lower in str(item.get("subject_tags", "")).lower()]
    if favorites_only:
        items = [item for item in items if bool(item.get("is_favorite"))]

    def sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
        if sort_by == "updated_asc":
            return (str(item.get("updated_at", "")),)
        if sort_by == "grade":
            return (str(item.get("grade_level", "")), str(item.get("updated_at", "")))
        if sort_by == "language":
            return (str(item.get("language", "")), str(item.get("updated_at", "")))
        if sort_by == "title":
            return (str(item.get("title", "")).lower(), str(item.get("updated_at", "")))
        return (str(item.get("updated_at", "")),)

    reverse = sort_by not in {"updated_asc", "grade", "language", "title"}
    items.sort(key=sort_key, reverse=reverse)
    return items


def load_cloud_test_record(record_id: int) -> dict[str, Any] | None:
    """Load one test payload from Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_test_history")
        .select("payload")
        .eq("id", int(record_id))
        .limit(1)
        .execute()
    )
    if not rows:
        return None
    return rows[0].get("payload")


def load_cloud_latest_test_record(test_uid: str, owner_email: str) -> dict[str, Any] | None:
    """Load the latest non-autosave payload for one test uid."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_test_history")
        .select("payload")
        .eq("test_uid", test_uid)
        .eq("owner_email", owner_email)
        .eq("is_autosave", False)
        .order("id", desc=True)
        .limit(1)
        .execute()
    )
    if not rows:
        return None
    return rows[0].get("payload")


def set_cloud_test_archived(test_uid: str, owner_email: str, archived: bool) -> None:
    """Archive or unarchive all snapshots for a test in Supabase."""
    client = get_client()
    client.table("teacher_test_history").update(
        {"archived": archived}
    ).eq("test_uid", test_uid).eq("owner_email", owner_email).execute()


def set_cloud_test_favorite(test_uid: str, owner_email: str, is_favorite: bool) -> None:
    """Mark or unmark a favorite test in Supabase."""
    client = get_client()
    client.table("teacher_test_history").update(
        {"is_favorite": is_favorite}
    ).eq("test_uid", test_uid).eq("owner_email", owner_email).execute()


def save_cloud_question_bank_item(record: dict[str, Any]) -> int:
    """Insert one question-bank row."""
    client = get_client()
    rows = _result_data(client.table("teacher_question_bank").insert(record).execute())
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def list_cloud_question_bank(limit: int = 50, owner_email: str | None = None) -> list[dict[str, Any]]:
    """List question bank rows from Supabase."""
    client = get_client()
    query = client.table("teacher_question_bank").select("*").order("created_at", desc=True).limit(limit)
    if owner_email:
        query = query.eq("owner_email", owner_email)
    return _result_data(query.execute())


def load_cloud_question_bank_item(record_id: int) -> dict[str, Any] | None:
    """Load one cloud question-bank payload."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_question_bank")
        .select("payload")
        .eq("id", int(record_id))
        .limit(1)
        .execute()
    )
    if not rows:
        return None
    return rows[0].get("payload")


def save_cloud_attempt_result(record: dict[str, Any]) -> int:
    """Insert one attempt result."""
    client = get_client()
    rows = _result_data(client.table("teacher_attempts").insert(record).execute())
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def list_cloud_attempt_results(
    limit: int = 50,
    owner_email: str | None = None,
    test_uid: str | None = None,
    student_name: str | None = None,
) -> list[dict[str, Any]]:
    """List attempt results from Supabase."""
    client = get_client()
    query = client.table("teacher_attempts").select("*").order("created_at", desc=True).limit(limit)
    if owner_email:
        query = query.eq("owner_email", owner_email)
    if test_uid:
        query = query.eq("test_uid", test_uid)
    if student_name:
        query = query.eq("student_name", student_name)
    rows = _result_data(query.execute())
    items = []
    for row in rows:
        item = dict(row)
        item["details"] = item.pop("payload", {})
        items.append(item)
    return items


def load_cloud_attempt_result(attempt_id: int) -> dict[str, Any] | None:
    """Load one attempt row from Supabase."""
    client = get_client()
    row = _first_row(
        client.table("teacher_attempts")
        .select("*")
        .eq("id", int(attempt_id))
        .limit(1)
        .execute()
    )
    if row is None:
        return None
    item = dict(row)
    item["details"] = item.pop("payload", {})
    return item


def update_cloud_attempt_result(
    *,
    attempt_id: int,
    student_name: str,
    percentage: float,
    review_status: str,
    teacher_note: str,
) -> bool:
    """Update one attempt in Supabase."""
    client = get_client()
    current = load_cloud_attempt_result(attempt_id)
    if current is None:
        return False
    details = dict(current.get("details", {}))
    details["percentage"] = round(float(percentage), 2)
    details.setdefault("attempt_meta", {})
    details["attempt_meta"]["manually_reviewed"] = True
    details["attempt_meta"]["teacher_note"] = teacher_note.strip()
    client.table("teacher_attempts").update(
        {
            "student_name": student_name.strip(),
            "percentage": round(float(percentage), 2),
            "review_status": review_status.strip() or "reviewed",
            "teacher_note": teacher_note.strip(),
            "payload": details,
        }
    ).eq("id", int(attempt_id)).execute()
    return True


def delete_cloud_attempt_result(attempt_id: int) -> bool:
    """Delete one attempt in Supabase."""
    client = get_client()
    client.table("teacher_attempts").delete().eq("id", int(attempt_id)).execute()
    return True


def count_cloud_share_attempts(token: str, student_name: str = "") -> int:
    """Count attempts for one share link, optionally scoped to a student name."""
    client = get_client()
    query = client.table("teacher_attempts").select("id").eq("share_token", token)
    if student_name.strip():
        query = query.ilike("student_name", student_name.strip())
    return len(_result_data(query.execute()))


def count_cloud_share_attempts_for_student_key(token: str, student_key: str) -> int:
    """Count attempts for one authenticated student identity in Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_attempts")
        .select("id")
        .eq("share_token", token)
        .eq("student_key", student_key.strip().lower())
        .execute()
    )
    return len(rows)


def cloud_attempt_submission_exists(submission_key: str) -> bool:
    """Return whether a submission key already exists in Supabase."""
    if not submission_key.strip():
        return False
    client = get_client()
    rows = _result_data(
        client.table("teacher_attempts")
        .select("id")
        .eq("submission_key", submission_key.strip())
        .limit(1)
        .execute()
    )
    return bool(rows)


def create_cloud_share_link(
    *,
    test_uid: str,
    title: str,
    variant_name: str,
    owner_email: str,
    payload: dict[str, Any],
    max_attempts: int = 1,
    deadline_at: str = "",
) -> str:
    """Create a share link row in Supabase."""
    client = get_client()
    token = secrets.token_urlsafe(18)
    client.table("teacher_share_links").insert(
        {
            "token": token,
            "test_uid": test_uid,
            "title": title,
            "variant_name": variant_name,
            "owner_email": owner_email,
            "is_active": True,
            "max_attempts": max_attempts,
            "deadline_at": deadline_at,
            "payload": payload,
        }
    ).execute()
    return token


def list_cloud_share_links(
    limit: int = 50,
    owner_email: str | None = None,
    test_uid: str | None = None,
) -> list[dict[str, Any]]:
    """List share links from Supabase."""
    client = get_client()
    query = client.table("teacher_share_links").select("*").order("created_at", desc=True).limit(limit)
    if owner_email:
        query = query.eq("owner_email", owner_email)
    if test_uid:
        query = query.eq("test_uid", test_uid)
    return _result_data(query.execute())


def load_cloud_share_link(token: str) -> dict[str, Any] | None:
    """Load one share link from Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_share_links")
        .select("*")
        .eq("token", token)
        .limit(1)
        .execute()
    )
    return rows[0] if rows else None


def set_cloud_share_link_status(token: str, is_active: bool) -> None:
    """Activate or deactivate one share link in Supabase."""
    client = get_client()
    client.table("teacher_share_links").update({"is_active": is_active}).eq("token", token).execute()


def save_cloud_student_draft(share_token: str, student_name: str, payload: dict[str, Any]) -> None:
    """Save or update one student draft in Supabase."""
    client = get_client()
    clean_name = student_name.strip()
    if not share_token.strip() or not clean_name:
        return
    existing = _result_data(
        client.table("teacher_student_drafts")
        .select("id")
        .eq("share_token", share_token)
        .eq("student_name", clean_name)
        .limit(1)
        .execute()
    )
    if existing:
        client.table("teacher_student_drafts").update({"payload": payload}).eq("id", existing[0]["id"]).execute()
    else:
        client.table("teacher_student_drafts").insert(
            {"share_token": share_token, "student_name": clean_name, "payload": payload}
        ).execute()


def load_cloud_student_draft(share_token: str, student_name: str) -> dict[str, Any] | None:
    """Load one student draft from Supabase."""
    client = get_client()
    clean_name = student_name.strip()
    if not share_token.strip() or not clean_name:
        return None
    rows = _result_data(
        client.table("teacher_student_drafts")
        .select("payload")
        .eq("share_token", share_token)
        .eq("student_name", clean_name)
        .limit(1)
        .execute()
    )
    return rows[0].get("payload") if rows else None


def delete_cloud_student_draft(share_token: str, student_name: str) -> None:
    """Delete one student draft from Supabase."""
    client = get_client()
    clean_name = student_name.strip()
    if not share_token.strip() or not clean_name:
        return
    client.table("teacher_student_drafts").delete().eq("share_token", share_token).eq("student_name", clean_name).execute()


def log_cloud_api_error(provider: str, error_message: str, context: dict[str, Any] | None = None) -> int:
    """Store one API error in Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_api_error_logs")
        .insert({"provider": provider, "error_message": error_message, "context_json": context or {}})
        .execute()
    )
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def list_cloud_api_error_logs(limit: int = 30) -> list[dict[str, Any]]:
    """List recent API errors from Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_api_error_logs")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    items = []
    for row in rows:
        item = dict(row)
        item["context"] = item.pop("context_json", {})
        items.append(item)
    return items


def log_cloud_audit_event(
    actor_email: str,
    actor_role: str,
    event_type: str,
    target_type: str = "",
    target_id: str = "",
    details: dict[str, Any] | None = None,
) -> int:
    """Store one audit log row in Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_audit_logs")
        .insert(
            {
                "actor_email": actor_email,
                "actor_role": actor_role,
                "event_type": event_type,
                "target_type": target_type,
                "target_id": target_id,
                "details_json": details or {},
            }
        )
        .execute()
    )
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def list_cloud_audit_logs(limit: int = 100, actor_email: str | None = None) -> list[dict[str, Any]]:
    """List recent audit log rows from Supabase."""
    client = get_client()
    query = client.table("teacher_audit_logs").select("*").order("created_at", desc=True).limit(limit)
    if actor_email:
        query = query.eq("actor_email", actor_email)
    rows = _result_data(query.execute())
    items = []
    for row in rows:
        item = dict(row)
        item["details"] = item.pop("details_json", {})
        items.append(item)
    return items


def record_cloud_usage_event(owner_email: str, event_type: str, quantity: int = 1, context: dict[str, Any] | None = None) -> int:
    """Store one usage event in Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_usage_events")
        .insert(
            {
                "owner_email": owner_email,
                "event_type": event_type,
                "quantity": quantity,
                "context_json": context or {},
            }
        )
        .execute()
    )
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def list_cloud_usage_events(limit: int = 200, owner_email: str | None = None) -> list[dict[str, Any]]:
    """List recent usage events from Supabase."""
    client = get_client()
    query = client.table("teacher_usage_events").select("*").order("created_at", desc=True).limit(limit)
    if owner_email:
        query = query.eq("owner_email", owner_email)
    rows = _result_data(query.execute())
    items = []
    for row in rows:
        item = dict(row)
        item["context"] = item.pop("context_json", {})
        items.append(item)
    return items


def get_cloud_plan_status(owner_email: str) -> dict[str, Any]:
    """Return plan and usage state from Supabase."""
    client = get_client()
    user = _first_row(
        client.table("app_users")
        .select("plan_name,trial_ends_at,account_status")
        .eq("email", owner_email)
        .limit(1)
        .execute()
    ) or {}
    plan_name = str(user.get("plan_name", "free") or "free")
    limits = {
        "free": {"monthly_generations": 30, "students": 50, "active_tests": 10},
        "trial": {"monthly_generations": 80, "students": 150, "active_tests": 25},
        "teacher_pro": {"monthly_generations": 500, "students": 1000, "active_tests": 200},
        "school": {"monthly_generations": 5000, "students": 10000, "active_tests": 5000},
        "student": {"monthly_generations": 0, "students": 0, "active_tests": 0},
    }.get(plan_name, {"monthly_generations": 30, "students": 50, "active_tests": 10})
    usage_events = list_cloud_usage_events(limit=5000, owner_email=owner_email)
    monthly_generations = sum(item["quantity"] for item in usage_events if item["event_type"] == "generation")
    return {
        "plan_name": plan_name,
        "trial_ends_at": user.get("trial_ends_at", ""),
        "account_status": user.get("account_status", "active"),
        "limits": limits,
        "usage": {"monthly_generations": monthly_generations},
    }


def sync_local_data_to_cloud(db_path: Path | str, owner_email: str) -> dict[str, int]:
    """Migrate key local SQLite rows for one teacher into Supabase."""
    client = get_client()
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    migrated = {"users": 0, "tests": 0, "attempts": 0, "groups": 0, "students": 0}
    try:
        user_rows = connection.execute(
            "SELECT email, display_name, password_hash, role, auth_provider, auth_user_id, plan_name, account_status, trial_ends_at FROM users WHERE email = ?",
            (owner_email,),
        ).fetchall()
        for row in user_rows:
            existing = _first_row(client.table("app_users").select("id").eq("email", row["email"]).limit(1).execute())
            if existing:
                continue
            client.table("app_users").insert(dict(row)).execute()
            migrated["users"] += 1

        for table_name, counter_key in (("teacher_groups", "groups"), ("teacher_group_students", "students")):
            pass

        test_rows = connection.execute("SELECT * FROM test_history WHERE owner_email = ?", (owner_email,)).fetchall()
        for row in test_rows:
            data = dict(row)
            data["payload"] = json.loads(data["payload"])
            client.table("teacher_test_history").insert(data).execute()
            migrated["tests"] += 1

        attempt_rows = connection.execute("SELECT * FROM test_attempts WHERE owner_email = ?", (owner_email,)).fetchall()
        for row in attempt_rows:
            data = dict(row)
            data["payload"] = json.loads(data["payload"])
            client.table("teacher_attempts").insert(data).execute()
            migrated["attempts"] += 1

        group_rows = connection.execute("SELECT * FROM teacher_groups WHERE owner_email = ?", (owner_email,)).fetchall()
        for row in group_rows:
            existing = _first_row(
                client.table("teacher_groups").select("id").eq("owner_email", owner_email).eq("name", row["name"]).limit(1).execute()
            )
            if existing:
                continue
            client.table("teacher_groups").insert(dict(row)).execute()
            migrated["groups"] += 1

        student_rows = connection.execute("SELECT * FROM teacher_group_students WHERE owner_email = ?", (owner_email,)).fetchall()
        for row in student_rows:
            existing = _first_row(
                client.table("teacher_group_students")
                .select("id")
                .eq("owner_email", owner_email)
                .eq("group_id", row["group_id"])
                .eq("full_name", row["full_name"])
                .eq("email", row["email"])
                .limit(1)
                .execute()
            )
            if existing:
                continue
            client.table("teacher_group_students").insert(dict(row)).execute()
            migrated["students"] += 1
    finally:
        connection.close()
    return migrated


def create_cloud_student_group(
    *,
    owner_email: str,
    name: str,
    grade_level: str = "",
    description: str = "",
) -> int:
    """Create one group/class in Supabase."""
    client = get_client()
    rows = _result_data(
        client.table("teacher_groups")
        .insert(
            {
                "owner_email": owner_email,
                "name": name.strip(),
                "grade_level": grade_level.strip(),
                "description": description.strip(),
            }
        )
        .execute()
    )
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def list_cloud_student_groups(owner_email: str) -> list[dict[str, Any]]:
    """List teacher groups from Supabase."""
    client = get_client()
    return _result_data(
        client.table("teacher_groups")
        .select("*")
        .eq("owner_email", owner_email)
        .order("created_at", desc=True)
        .execute()
    )


def save_cloud_group_student(
    *,
    owner_email: str,
    group_id: int,
    full_name: str,
    email: str = "",
    external_id: str = "",
    notes: str = "",
) -> int:
    """Insert or update one roster student in Supabase."""
    client = get_client()
    clean_name = full_name.strip()
    clean_email = email.strip().lower()
    existing = _first_row(
        client.table("teacher_group_students")
        .select("id")
        .eq("group_id", int(group_id))
        .eq("owner_email", owner_email)
        .eq("full_name", clean_name)
        .eq("email", clean_email)
        .limit(1)
        .execute()
    )
    payload = {
        "owner_email": owner_email,
        "group_id": int(group_id),
        "full_name": clean_name,
        "email": clean_email,
        "external_id": external_id.strip(),
        "notes": notes.strip(),
    }
    if existing is not None:
        client.table("teacher_group_students").update(payload).eq("id", existing["id"]).execute()
        return int(existing["id"])
    rows = _result_data(client.table("teacher_group_students").insert(payload).execute())
    return int(rows[0]["id"]) if rows and rows[0].get("id") is not None else 0


def list_cloud_group_students(owner_email: str, group_id: int | None = None) -> list[dict[str, Any]]:
    """List imported roster students from Supabase."""
    client = get_client()
    query = client.table("teacher_group_students").select("*, teacher_groups(name, grade_level)").eq("owner_email", owner_email)
    if group_id is not None:
        query = query.eq("group_id", int(group_id))
    rows = _result_data(query.order("created_at", desc=False).execute())
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        group_row = item.pop("teacher_groups", {}) or {}
        item["group_name"] = group_row.get("name", "")
        item["grade_level"] = group_row.get("grade_level", "")
        items.append(item)
    items.sort(key=lambda row: (str(row.get("group_name", "")), str(row.get("full_name", "")).lower()))
    return items


# Backward-compatible sync-style wrappers
def sync_history_record(record: dict[str, Any]) -> str:
    save_cloud_test_record(record)
    return "History record synced to Supabase."


def sync_question_bank_item(record: dict[str, Any]) -> str:
    save_cloud_question_bank_item(record)
    return "Question bank item synced to Supabase."


def sync_attempt_result(record: dict[str, Any]) -> str:
    save_cloud_attempt_result(record)
    return "Attempt result synced to Supabase."
