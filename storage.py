"""SQLite helpers for users, history, attempts, question bank, and share links."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from cloud_sync import (
    authenticate_cloud_user,
    cloud_attempt_submission_exists,
    count_cloud_share_attempts,
    count_cloud_share_attempts_for_student_key,
    create_cloud_share_link,
    create_cloud_student_group,
    create_cloud_user,
    delete_cloud_attempt_result,
    delete_cloud_student_draft,
    find_cloud_autosave_record,
    get_cloud_plan_status,
    is_cloud_enabled as is_supabase_configured,
    list_cloud_audit_logs,
    list_cloud_api_error_logs,
    list_cloud_attempt_results,
    list_cloud_group_students,
    list_cloud_student_groups,
    list_cloud_question_bank,
    list_cloud_share_links,
    list_cloud_test_history,
    list_cloud_test_library,
    list_cloud_usage_events,
    load_cloud_attempt_result,
    load_cloud_latest_test_record,
    load_cloud_question_bank_item,
    load_cloud_share_link,
    load_cloud_student_draft,
    load_cloud_test_record,
    log_cloud_audit_event,
    log_cloud_api_error,
    record_cloud_usage_event,
    save_cloud_group_student,
    save_cloud_attempt_result,
    save_cloud_question_bank_item,
    save_cloud_student_draft,
    save_cloud_test_record,
    set_cloud_share_link_status,
    set_cloud_test_archived,
    set_cloud_test_favorite,
    sync_local_data_to_cloud,
    update_cloud_autosave_record,
    update_cloud_attempt_result,
)


DB_PATH = Path(__file__).resolve().parent / "teacher_history.db"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_cloud_enabled() -> bool:
    """Return whether storage should use Supabase as the primary backend.

    The default is local-first because it is faster and more stable for live demos.
    Set APP_STORAGE_MODE=cloud to opt into Supabase-backed primary storage again.
    """
    return os.getenv("APP_STORAGE_MODE", "local").strip().lower() == "cloud" and is_supabase_configured()


def is_valid_email(value: str) -> bool:
    """Return whether an email looks valid enough for product use."""
    return bool(EMAIL_RE.match(value.strip().lower()))


def get_connection() -> sqlite3.Connection:
    """Create a database connection."""
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    return connection


def _write_local_api_error(provider: str, error_message: str, context: dict[str, Any] | None = None) -> None:
    """Write an error directly to the local SQLite log without touching cloud code."""
    try:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO api_error_logs (provider, error_message, context_json)
                VALUES (?, ?, ?)
                """,
                (
                    provider,
                    error_message,
                    json.dumps(context or {}, ensure_ascii=False),
                ),
            )
    except Exception:
        return


def _try_cloud_call(operation: str, func: Any, *args: Any, **kwargs: Any) -> tuple[bool, Any]:
    """Try one cloud operation and fall back gracefully on failure."""
    try:
        return True, func(*args, **kwargs)
    except Exception as error:
        _write_local_api_error(
            "supabase",
            f"{operation} failed",
            {"error": str(error)},
        )
        return False, None


def initialize_database() -> None:
    """Create all project tables if they do not exist."""
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                auth_provider TEXT DEFAULT 'local',
                auth_user_id TEXT DEFAULT '',
                plan_name TEXT DEFAULT 'free',
                account_status TEXT DEFAULT 'active',
                trial_ends_at TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS test_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_uid TEXT DEFAULT '',
                title TEXT NOT NULL,
                topic TEXT NOT NULL,
                language TEXT NOT NULL,
                difficulty TEXT NOT NULL,
                test_type TEXT NOT NULL,
                grade_level TEXT DEFAULT '',
                assessment_purpose TEXT DEFAULT '',
                owner_email TEXT DEFAULT '',
                source_kind TEXT NOT NULL,
                source_name TEXT,
                subject_tags TEXT DEFAULT '',
                is_favorite INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                is_autosave INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payload TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS question_bank (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_text TEXT NOT NULL,
                question_type TEXT NOT NULL,
                topic TEXT DEFAULT '',
                skill_tag TEXT DEFAULT '',
                owner_email TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payload TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS test_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                student_name TEXT NOT NULL,
                student_key TEXT DEFAULT '',
                test_uid TEXT DEFAULT '',
                variant_name TEXT NOT NULL,
                test_title TEXT NOT NULL,
                owner_email TEXT DEFAULT '',
                share_token TEXT DEFAULT '',
                submission_key TEXT DEFAULT '',
                review_status TEXT DEFAULT 'submitted',
                teacher_note TEXT DEFAULT '',
                answer_signature TEXT DEFAULT '',
                percentage REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payload TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS student_drafts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                share_token TEXT NOT NULL,
                student_name TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(share_token, student_name)
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS api_error_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                error_message TEXT NOT NULL,
                context_json TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_email TEXT NOT NULL,
                actor_role TEXT DEFAULT '',
                event_type TEXT NOT NULL,
                target_type TEXT DEFAULT '',
                target_id TEXT DEFAULT '',
                details_json TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS usage_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_email TEXT NOT NULL,
                event_type TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                context_json TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS share_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                test_uid TEXT DEFAULT '',
                title TEXT NOT NULL,
                variant_name TEXT NOT NULL,
                owner_email TEXT DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 1,
                max_attempts INTEGER NOT NULL DEFAULT 1,
                deadline_at TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payload TEXT NOT NULL
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS teacher_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_email TEXT NOT NULL,
                name TEXT NOT NULL,
                grade_level TEXT DEFAULT '',
                description TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS teacher_group_students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_email TEXT NOT NULL,
                group_id INTEGER NOT NULL,
                full_name TEXT NOT NULL,
                email TEXT DEFAULT '',
                external_id TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, email, full_name)
            )
            """
        )

        for column_name, definition in (
            ("test_uid", "TEXT DEFAULT ''"),
            ("grade_level", "TEXT DEFAULT ''"),
            ("assessment_purpose", "TEXT DEFAULT ''"),
            ("owner_email", "TEXT DEFAULT ''"),
            ("subject_tags", "TEXT DEFAULT ''"),
            ("is_favorite", "INTEGER NOT NULL DEFAULT 0"),
            ("archived", "INTEGER NOT NULL DEFAULT 0"),
            ("is_autosave", "INTEGER NOT NULL DEFAULT 0"),
            ("updated_at", "TEXT DEFAULT ''"),
        ):
            ensure_column(connection, "test_history", column_name, definition)

        ensure_column(connection, "test_attempts", "share_token", "TEXT DEFAULT ''")
        ensure_column(connection, "test_attempts", "test_uid", "TEXT DEFAULT ''")
        ensure_column(connection, "test_attempts", "student_key", "TEXT DEFAULT ''")
        ensure_column(connection, "test_attempts", "submission_key", "TEXT DEFAULT ''")
        ensure_column(connection, "test_attempts", "updated_at", "TEXT DEFAULT CURRENT_TIMESTAMP")
        ensure_column(connection, "test_attempts", "review_status", "TEXT DEFAULT 'submitted'")
        ensure_column(connection, "test_attempts", "teacher_note", "TEXT DEFAULT ''")
        ensure_column(connection, "test_attempts", "answer_signature", "TEXT DEFAULT ''")
        for column_name, definition in (
            ("auth_provider", "TEXT DEFAULT 'local'"),
            ("auth_user_id", "TEXT DEFAULT ''"),
            ("plan_name", "TEXT DEFAULT 'free'"),
            ("account_status", "TEXT DEFAULT 'active'"),
            ("trial_ends_at", "TEXT DEFAULT ''"),
        ):
            ensure_column(connection, "users", column_name, definition)

        connection.execute(
            """
            INSERT INTO schema_meta (key, value)
            VALUES ('schema_version', '4')
            ON CONFLICT(key) DO UPDATE SET value = '4'
            """
        )

        for column_name, definition in (
            ("test_uid", "TEXT DEFAULT ''"),
            ("max_attempts", "INTEGER NOT NULL DEFAULT 1"),
            ("deadline_at", "TEXT DEFAULT ''"),
        ):
            ensure_column(connection, "share_links", column_name, definition)


def ensure_column(
    connection: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    """Add a column if it does not already exist."""
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    column_names = {row[1] for row in rows}
    if column_name not in column_names:
        try:
            connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")
        except sqlite3.OperationalError as error:
            if "non-constant default" not in str(error).lower():
                raise
            safe_definition = column_definition.replace("DEFAULT CURRENT_TIMESTAMP", "DEFAULT ''")
            connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {safe_definition}")


def hash_password(password: str, salt: str | None = None) -> str:
    """Hash a password with PBKDF2."""
    salt = salt or secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000,
    ).hex()
    return f"{salt}${password_hash}"


def verify_password(password: str, stored_value: str) -> bool:
    """Verify a password against a stored hash."""
    try:
        salt, expected_hash = stored_value.split("$", 1)
    except ValueError:
        return False

    actual_hash = hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(actual_hash, expected_hash)


def create_local_user(email: str, password: str, display_name: str, role: str) -> tuple[bool, str]:
    """Create a local user profile."""
    email = email.strip().lower()
    display_name = display_name.strip()
    role = role.strip().lower()

    if not email or not password or not display_name:
        return False, "Email, password, and display name are required."
    if not is_valid_email(email):
        return False, "Enter a valid email address."
    if role not in {"teacher", "student"}:
        return False, "Role must be teacher or student."
    if len(password) < 8:
        return False, "Password must contain at least 8 characters."

    if is_cloud_enabled():
        ok, result = _try_cloud_call("create_cloud_user", create_cloud_user, email, password, display_name, role)
        if ok:
            return result

    try:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO users (email, display_name, password_hash, role, plan_name, trial_ends_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    email,
                    display_name,
                    hash_password(password),
                    role,
                    "trial" if role == "teacher" else "student",
                    "" if role == "student" else (datetime.now(UTC) + timedelta(days=14)).replace(microsecond=0).isoformat(),
                ),
            )
    except sqlite3.IntegrityError:
        return False, "A user with this email already exists."

    if is_supabase_configured():
        try:
            create_cloud_user(email, password, display_name, role)
        except Exception:
            _write_local_api_error(
                "supabase",
                "create_cloud_user mirror failed",
                {"email": email},
            )

    return True, "Profile created successfully."


def authenticate_local_user(email: str, password: str) -> dict[str, Any] | None:
    """Authenticate a local user."""
    email = email.strip().lower()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT email, display_name, password_hash, role, plan_name, account_status, trial_ends_at
            FROM users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()

    if row is None:
        if is_supabase_configured():
            try:
                cloud_user = authenticate_cloud_user(email, password)
            except Exception as error:
                _write_local_api_error(
                    "supabase",
                    "authenticate_cloud_user fallback failed",
                    {"email": email, "error": str(error)},
                )
                cloud_user = None
            if cloud_user is not None:
                try:
                    with get_connection() as connection:
                        connection.execute(
                            """
                            INSERT INTO users (email, display_name, password_hash, role, plan_name, account_status, trial_ends_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(email) DO UPDATE SET
                                display_name = excluded.display_name,
                                password_hash = excluded.password_hash,
                                role = excluded.role,
                                plan_name = excluded.plan_name,
                                account_status = excluded.account_status,
                                trial_ends_at = excluded.trial_ends_at
                            """,
                            (
                                cloud_user["email"],
                                cloud_user["display_name"],
                                hash_password(password),
                                cloud_user["role"],
                                cloud_user.get("plan_name", "free" if cloud_user.get("role") == "teacher" else "student"),
                                cloud_user.get("account_status", "active"),
                                cloud_user.get("trial_ends_at", ""),
                            ),
                        )
                except Exception:
                    pass
                return cloud_user
        return None

    if not verify_password(password, row["password_hash"]):
        return None

    return {
        "email": row["email"],
        "display_name": row["display_name"],
        "role": row["role"],
        "plan_name": row["plan_name"],
        "account_status": row["account_status"],
        "trial_ends_at": row["trial_ends_at"],
    }


def save_test_record(
    *,
    test_uid: str,
    title: str,
    topic: str,
    language: str,
    difficulty: str,
    test_type: str,
    grade_level: str,
    assessment_purpose: str,
    owner_email: str,
    source_kind: str,
    source_name: str,
    subject_tags: str = "",
    is_favorite: bool = False,
    payload: dict[str, Any],
    archived: bool = False,
    is_autosave: bool = False,
) -> int:
    """Insert a test snapshot into history and return its ID."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "save_cloud_test_record",
            save_cloud_test_record,
            {
                "test_uid": test_uid,
                "title": title,
                "topic": topic,
                "language": language,
                "difficulty": difficulty,
                "test_type": test_type,
                "grade_level": grade_level,
                "assessment_purpose": assessment_purpose,
                "owner_email": owner_email,
                "source_kind": source_kind,
                "source_name": source_name or "",
                "subject_tags": subject_tags,
                "is_favorite": is_favorite,
                "archived": archived,
                "is_autosave": is_autosave,
                "payload": payload,
            },
        )
        if ok:
            return int(result)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO test_history (
                test_uid,
                title,
                topic,
                language,
                difficulty,
                test_type,
                grade_level,
                assessment_purpose,
                owner_email,
                source_kind,
                source_name,
                subject_tags,
                is_favorite,
                archived,
                is_autosave,
                updated_at,
                payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            """,
            (
                test_uid,
                title,
                topic,
                language,
                difficulty,
                test_type,
                grade_level,
                assessment_purpose,
                owner_email,
                source_kind,
                source_name or "",
                subject_tags,
                1 if is_favorite else 0,
                1 if archived else 0,
                1 if is_autosave else 0,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
        return int(cursor.lastrowid)


def upsert_autosave_record(
    *,
    test_uid: str,
    title: str,
    topic: str,
    language: str,
    difficulty: str,
    test_type: str,
    grade_level: str,
    assessment_purpose: str,
    owner_email: str,
    source_kind: str,
    source_name: str,
    subject_tags: str = "",
    is_favorite: bool = False,
    payload: dict[str, Any],
) -> int:
    """Create or update one autosave draft record for a test."""
    if is_cloud_enabled():
        ok, row = _try_cloud_call("find_cloud_autosave_record", find_cloud_autosave_record, test_uid, owner_email)
        if ok:
            record = {
                "test_uid": test_uid,
                "title": title,
                "topic": topic,
                "language": language,
                "difficulty": difficulty,
                "test_type": test_type,
                "grade_level": grade_level,
                "assessment_purpose": assessment_purpose,
                "owner_email": owner_email,
                "source_kind": source_kind,
                "source_name": source_name or "",
                "subject_tags": subject_tags,
                "is_favorite": is_favorite,
                "is_autosave": True,
                "payload": payload,
            }
            if row is None:
                ok_save, result = _try_cloud_call("save_cloud_test_record", save_cloud_test_record, record)
                if ok_save:
                    return int(result)
            else:
                ok_update, result = _try_cloud_call(
                    "update_cloud_autosave_record",
                    update_cloud_autosave_record,
                    int(row["id"]),
                    record,
                )
                if ok_update:
                    return int(result)

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id
            FROM test_history
            WHERE test_uid = ? AND owner_email = ? AND is_autosave = 1
            ORDER BY id DESC
            LIMIT 1
            """,
            (test_uid, owner_email),
        ).fetchone()

        if row is None:
            return save_test_record(
                test_uid=test_uid,
                title=title,
                topic=topic,
                language=language,
                difficulty=difficulty,
                test_type=test_type,
                grade_level=grade_level,
                assessment_purpose=assessment_purpose,
                owner_email=owner_email,
                source_kind=source_kind,
                source_name=source_name,
                subject_tags=subject_tags,
                is_favorite=is_favorite,
                payload=payload,
                is_autosave=True,
            )

        connection.execute(
            """
            UPDATE test_history
            SET
                title = ?,
                topic = ?,
                language = ?,
                difficulty = ?,
                test_type = ?,
                grade_level = ?,
                assessment_purpose = ?,
                source_kind = ?,
                source_name = ?,
                subject_tags = ?,
                is_favorite = ?,
                updated_at = CURRENT_TIMESTAMP,
                payload = ?
            WHERE id = ?
            """,
            (
                title,
                topic,
                language,
                difficulty,
                test_type,
                grade_level,
                assessment_purpose,
                source_kind,
                source_name or "",
                subject_tags,
                1 if is_favorite else 0,
                json.dumps(payload, ensure_ascii=False),
                int(row["id"]),
            ),
        )
        return int(row["id"])


def list_test_history(limit: int = 20, owner_email: str | None = None) -> list[dict[str, Any]]:
    """Return recent history entries."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("list_cloud_test_history", list_cloud_test_history, limit=limit, owner_email=owner_email)
        if ok:
            return result

    query = """
        SELECT
            id,
            test_uid,
            title,
            topic,
            language,
            difficulty,
            test_type,
            grade_level,
            assessment_purpose,
            owner_email,
            source_kind,
            source_name,
            subject_tags,
            is_favorite,
            archived,
            is_autosave,
            updated_at,
            created_at
        FROM test_history
    """
    params: list[Any] = []
    if owner_email:
        query += " WHERE owner_email = ?"
        params.append(owner_email)
    query += " ORDER BY datetime(updated_at) DESC, id DESC LIMIT ?"
    params.append(limit)

    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def list_test_library(
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
    """Return one latest non-autosave snapshot per test UID for the teacher library."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "list_cloud_test_library",
            list_cloud_test_library,
            owner_email=owner_email,
            search=search,
            language=language,
            grade_level=grade_level,
            topic=topic,
            subject_tag=subject_tag,
            include_archived=include_archived,
            favorites_only=favorites_only,
            sort_by=sort_by,
        )
        if ok:
            return result

    query = """
        SELECT th.*
        FROM test_history th
        INNER JOIN (
            SELECT test_uid, MAX(id) AS max_id
            FROM test_history
            WHERE owner_email = ? AND is_autosave = 0
            GROUP BY test_uid
        ) latest ON latest.max_id = th.id
        WHERE th.owner_email = ?
    """
    params: list[Any] = [owner_email, owner_email]
    if not include_archived:
        query += " AND th.archived = 0"
    if search.strip():
        query += " AND (LOWER(th.title) LIKE ? OR LOWER(th.topic) LIKE ? OR LOWER(COALESCE(th.source_name, '')) LIKE ?)"
        like = f"%{search.strip().lower()}%"
        params.extend([like, like, like])
    if language:
        query += " AND th.language = ?"
        params.append(language)
    if grade_level:
        query += " AND th.grade_level = ?"
        params.append(grade_level)
    if topic.strip():
        query += " AND LOWER(th.topic) LIKE ?"
        params.append(f"%{topic.strip().lower()}%")
    if subject_tag.strip():
        query += " AND LOWER(th.subject_tags) LIKE ?"
        params.append(f"%{subject_tag.strip().lower()}%")
    if favorites_only:
        query += " AND th.is_favorite = 1"

    sort_sql = {
        "updated_desc": "datetime(th.updated_at) DESC, th.id DESC",
        "updated_asc": "datetime(th.updated_at) ASC, th.id ASC",
        "grade": "th.grade_level ASC, datetime(th.updated_at) DESC",
        "language": "th.language ASC, datetime(th.updated_at) DESC",
        "title": "th.title ASC, datetime(th.updated_at) DESC",
    }.get(sort_by, "datetime(th.updated_at) DESC, th.id DESC")
    query += f" ORDER BY {sort_sql}"

    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def load_test_record(record_id: int) -> dict[str, Any] | None:
    """Load a specific saved test payload."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("load_cloud_test_record", load_cloud_test_record, record_id)
        if ok:
            return result

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT payload
            FROM test_history
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()
    if row is None:
        return None
    return json.loads(row["payload"])


def load_latest_test_record(test_uid: str, owner_email: str) -> dict[str, Any] | None:
    """Load the latest non-autosave record for a test UID."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("load_cloud_latest_test_record", load_cloud_latest_test_record, test_uid, owner_email)
        if ok:
            return result

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT payload
            FROM test_history
            WHERE test_uid = ? AND owner_email = ? AND is_autosave = 0
            ORDER BY id DESC
            LIMIT 1
            """,
            (test_uid, owner_email),
        ).fetchone()
    if row is None:
        return None
    return json.loads(row["payload"])


def set_test_archived(test_uid: str, owner_email: str, archived: bool) -> None:
    """Archive or unarchive all snapshots for a test."""
    if is_cloud_enabled():
        ok, _ = _try_cloud_call("set_cloud_test_archived", set_cloud_test_archived, test_uid, owner_email, archived)
        if ok:
            return

    with get_connection() as connection:
        connection.execute(
            """
            UPDATE test_history
            SET archived = ?, updated_at = CURRENT_TIMESTAMP
            WHERE test_uid = ? AND owner_email = ?
            """,
            (1 if archived else 0, test_uid, owner_email),
        )


def set_test_favorite(test_uid: str, owner_email: str, is_favorite: bool) -> None:
    """Mark a test as favorite or remove the favorite flag."""
    if is_cloud_enabled():
        ok, _ = _try_cloud_call("set_cloud_test_favorite", set_cloud_test_favorite, test_uid, owner_email, is_favorite)
        if ok:
            return

    with get_connection() as connection:
        connection.execute(
            """
            UPDATE test_history
            SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP
            WHERE test_uid = ? AND owner_email = ?
            """,
            (1 if is_favorite else 0, test_uid, owner_email),
        )


def save_question_bank_item(
    *,
    question_text: str,
    question_type: str,
    topic: str,
    skill_tag: str,
    owner_email: str,
    payload: dict[str, Any],
) -> int:
    """Save a question into the local question bank."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "save_cloud_question_bank_item",
            save_cloud_question_bank_item,
            {
                "question_text": question_text,
                "question_type": question_type,
                "topic": topic,
                "skill_tag": skill_tag,
                "owner_email": owner_email,
                "payload": payload,
            },
        )
        if ok:
            return int(result)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO question_bank (
                question_text,
                question_type,
                topic,
                skill_tag,
                owner_email,
                payload
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                question_text,
                question_type,
                topic,
                skill_tag,
                owner_email,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
        return int(cursor.lastrowid)


def list_question_bank(limit: int = 50, owner_email: str | None = None) -> list[dict[str, Any]]:
    """List saved question bank items."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("list_cloud_question_bank", list_cloud_question_bank, limit=limit, owner_email=owner_email)
        if ok:
            return result

    query = """
        SELECT
            id,
            question_text,
            question_type,
            topic,
            skill_tag,
            owner_email,
            created_at
        FROM question_bank
    """
    params: list[Any] = []
    if owner_email:
        query += " WHERE owner_email = ?"
        params.append(owner_email)
    query += " ORDER BY datetime(created_at) DESC, id DESC LIMIT ?"
    params.append(limit)

    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def load_question_bank_item(record_id: int) -> dict[str, Any] | None:
    """Load one question bank item."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("load_cloud_question_bank_item", load_cloud_question_bank_item, record_id)
        if ok:
            return result

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT payload
            FROM question_bank
            WHERE id = ?
            """,
            (record_id,),
        ).fetchone()
    if row is None:
        return None
    return json.loads(row["payload"])


def save_attempt_result(
    *,
    student_name: str,
    student_key: str = "",
    test_uid: str,
    variant_name: str,
    test_title: str,
    owner_email: str,
    share_token: str,
    submission_key: str = "",
    review_status: str = "submitted",
    teacher_note: str = "",
    answer_signature: str = "",
    percentage: float,
    payload: dict[str, Any],
) -> int:
    """Save a student attempt."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "save_cloud_attempt_result",
            save_cloud_attempt_result,
            {
                "student_name": student_name,
                "student_key": student_key,
                "test_uid": test_uid,
                "variant_name": variant_name,
                "test_title": test_title,
                "owner_email": owner_email,
                "share_token": share_token,
                "submission_key": submission_key,
                "review_status": review_status,
                "teacher_note": teacher_note,
                "answer_signature": answer_signature,
                "percentage": percentage,
                "payload": payload,
            },
        )
        if ok:
            return int(result)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO test_attempts (
                student_name,
                student_key,
                test_uid,
                variant_name,
                test_title,
                owner_email,
                share_token,
                submission_key,
                review_status,
                teacher_note,
                answer_signature,
                percentage,
                payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                student_name,
                student_key,
                test_uid,
                variant_name,
                test_title,
                owner_email,
                share_token,
                submission_key,
                review_status,
                teacher_note,
                answer_signature,
                percentage,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
        return int(cursor.lastrowid)


def list_attempt_results(
    limit: int = 50,
    owner_email: str | None = None,
    test_uid: str | None = None,
    student_name: str | None = None,
) -> list[dict[str, Any]]:
    """List recent student attempts."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "list_cloud_attempt_results",
            list_cloud_attempt_results,
            limit=limit,
            owner_email=owner_email,
            test_uid=test_uid,
            student_name=student_name,
        )
        if ok:
            return result

    query = """
        SELECT
            id,
            updated_at,
            student_name,
            student_key,
            test_uid,
            variant_name,
            test_title,
            owner_email,
            share_token,
            submission_key,
            review_status,
            teacher_note,
            answer_signature,
            percentage,
            created_at,
            payload
        FROM test_attempts
    """
    params: list[Any] = []
    filters: list[str] = []
    if owner_email:
        filters.append("owner_email = ?")
        params.append(owner_email)
    if test_uid:
        filters.append("test_uid = ?")
        params.append(test_uid)
    if student_name:
        filters.append("student_name = ?")
        params.append(student_name)
    if filters:
        query += " WHERE " + " AND ".join(filters)
    query += " ORDER BY datetime(created_at) DESC, id DESC LIMIT ?"
    params.append(limit)

    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()

    items = []
    for row in rows:
        item = dict(row)
        item["details"] = json.loads(item.pop("payload"))
        items.append(item)
    return items


def load_attempt_result(attempt_id: int) -> dict[str, Any] | None:
    """Load one attempt with full metadata."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("load_cloud_attempt_result", load_cloud_attempt_result, attempt_id)
        if ok:
            return result

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT
                id,
                updated_at,
                student_name,
                student_key,
                test_uid,
                variant_name,
                test_title,
                owner_email,
                share_token,
                submission_key,
                review_status,
                teacher_note,
                answer_signature,
                percentage,
                created_at,
                payload
            FROM test_attempts
            WHERE id = ?
            LIMIT 1
            """,
            (attempt_id,),
        ).fetchone()
    if row is None:
        return None
    item = dict(row)
    item["details"] = json.loads(item.pop("payload"))
    return item


def update_attempt_result(
    *,
    attempt_id: int,
    student_name: str,
    percentage: float,
    review_status: str,
    teacher_note: str,
) -> bool:
    """Update one attempt after teacher review."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "update_cloud_attempt_result",
            update_cloud_attempt_result,
            attempt_id=attempt_id,
            student_name=student_name,
            percentage=percentage,
            review_status=review_status,
            teacher_note=teacher_note,
        )
        if ok:
            return bool(result)

    current = load_attempt_result(attempt_id)
    if current is None:
        return False

    details = dict(current.get("details", {}))
    details["percentage"] = round(float(percentage), 2)
    details.setdefault("attempt_meta", {})
    details["attempt_meta"]["manually_reviewed"] = True
    details["attempt_meta"]["teacher_note"] = teacher_note.strip()

    with get_connection() as connection:
        cursor = connection.execute(
            """
            UPDATE test_attempts
            SET
                student_name = ?,
                percentage = ?,
                review_status = ?,
                teacher_note = ?,
                updated_at = CURRENT_TIMESTAMP,
                payload = ?
            WHERE id = ?
            """,
            (
                student_name.strip(),
                round(float(percentage), 2),
                review_status.strip() or "reviewed",
                teacher_note.strip(),
                json.dumps(details, ensure_ascii=False),
                attempt_id,
            ),
        )
    return cursor.rowcount > 0


def delete_attempt_result(attempt_id: int) -> bool:
    """Delete one attempt record."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("delete_cloud_attempt_result", delete_cloud_attempt_result, attempt_id)
        if ok:
            return bool(result)

    with get_connection() as connection:
        cursor = connection.execute("DELETE FROM test_attempts WHERE id = ?", (attempt_id,))
    return cursor.rowcount > 0


def count_share_attempts(token: str, student_name: str = "") -> int:
    """Count attempts for a share link, optionally scoped to one student."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("count_cloud_share_attempts", count_cloud_share_attempts, token, student_name)
        if ok:
            return int(result)

    query = "SELECT COUNT(*) FROM test_attempts WHERE share_token = ?"
    params: list[Any] = [token]
    if student_name.strip():
        query += " AND LOWER(student_name) = ?"
        params.append(student_name.strip().lower())
    with get_connection() as connection:
        if len(params) == 2:
            row = connection.execute(query, (params[0], params[1])).fetchone()
        else:
            row = connection.execute(query, (params[0],)).fetchone()
    return int(row[0]) if row else 0


def count_share_attempts_for_student_key(token: str, student_key: str) -> int:
    """Count attempts for one authenticated student identity."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "count_cloud_share_attempts_for_student_key",
            count_cloud_share_attempts_for_student_key,
            token,
            student_key,
        )
        if ok:
            return int(result)

    if not token.strip() or not student_key.strip():
        return 0
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT COUNT(*)
            FROM test_attempts
            WHERE share_token = ? AND student_key = ?
            """,
            (token.strip(), student_key.strip().lower()),
        ).fetchone()
    return int(row[0]) if row else 0


def attempt_submission_exists(submission_key: str) -> bool:
    """Return whether this submission fingerprint already exists."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("cloud_attempt_submission_exists", cloud_attempt_submission_exists, submission_key)
        if ok:
            return bool(result)

    if not submission_key.strip():
        return False
    with get_connection() as connection:
        row = connection.execute(
            "SELECT 1 FROM test_attempts WHERE submission_key = ? LIMIT 1",
            (submission_key.strip(),),
        ).fetchone()
    return row is not None


def create_share_link(
    *,
    test_uid: str,
    title: str,
    variant_name: str,
    owner_email: str,
    payload: dict[str, Any],
    max_attempts: int = 1,
    deadline_at: str = "",
) -> str:
    """Create a share token for student access."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "create_cloud_share_link",
            create_cloud_share_link,
            test_uid=test_uid,
            title=title,
            variant_name=variant_name,
            owner_email=owner_email,
            payload=payload,
            max_attempts=max_attempts,
            deadline_at=deadline_at,
        )
        if ok and result:
            return str(result)

    token = secrets.token_urlsafe(18)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO share_links (
                token,
                test_uid,
                title,
                variant_name,
                owner_email,
                max_attempts,
                deadline_at,
                payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                token,
                test_uid,
                title,
                variant_name,
                owner_email,
                max_attempts,
                deadline_at,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
    return token


def list_share_links(
    limit: int = 50,
    owner_email: str | None = None,
    test_uid: str | None = None,
) -> list[dict[str, Any]]:
    """List recent share links."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "list_cloud_share_links",
            list_cloud_share_links,
            limit=limit,
            owner_email=owner_email,
            test_uid=test_uid,
        )
        if ok:
            return result

    query = """
        SELECT
            id,
            token,
            test_uid,
            title,
            variant_name,
            owner_email,
            is_active,
            max_attempts,
            deadline_at,
            created_at
        FROM share_links
    """
    params: list[Any] = []
    filters: list[str] = []
    if owner_email:
        filters.append("owner_email = ?")
        params.append(owner_email)
    if test_uid:
        filters.append("test_uid = ?")
        params.append(test_uid)
    if filters:
        query += " WHERE " + " AND ".join(filters)
    query += " ORDER BY datetime(created_at) DESC, id DESC LIMIT ?"
    params.append(limit)

    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def load_share_link(token: str) -> dict[str, Any] | None:
    """Load a share link by token."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("load_cloud_share_link", load_cloud_share_link, token)
        if ok:
            return result

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT token, test_uid, title, variant_name, owner_email, is_active, max_attempts, deadline_at, payload
            FROM share_links
            WHERE token = ?
            """,
            (token,),
        ).fetchone()
    if row is None:
        return None
    item = dict(row)
    item["payload"] = json.loads(item["payload"])
    return item


def set_share_link_status(token: str, is_active: bool) -> None:
    """Activate or deactivate a share link."""
    if is_cloud_enabled():
        ok, _ = _try_cloud_call("set_cloud_share_link_status", set_cloud_share_link_status, token, is_active)
        if ok:
            return

    with get_connection() as connection:
        connection.execute(
            """
            UPDATE share_links
            SET is_active = ?
            WHERE token = ?
            """,
            (1 if is_active else 0, token),
        )


def save_student_draft(share_token: str, student_name: str, payload: dict[str, Any]) -> None:
    """Create or update a draft for one student/share combination."""
    if is_cloud_enabled():
        ok, _ = _try_cloud_call("save_cloud_student_draft", save_cloud_student_draft, share_token, student_name, payload)
        if ok:
            return

    clean_name = student_name.strip()
    if not share_token.strip() or not clean_name:
        return
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO student_drafts (share_token, student_name, payload, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(share_token, student_name)
            DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
            """,
            (share_token, clean_name, json.dumps(payload, ensure_ascii=False)),
        )


def load_student_draft(share_token: str, student_name: str) -> dict[str, Any] | None:
    """Load a saved draft for one student/share combination."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("load_cloud_student_draft", load_cloud_student_draft, share_token, student_name)
        if ok:
            return result

    clean_name = student_name.strip()
    if not share_token.strip() or not clean_name:
        return None
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT payload
            FROM student_drafts
            WHERE share_token = ? AND student_name = ?
            LIMIT 1
            """,
            (share_token, clean_name),
        ).fetchone()
    if row is None:
        return None
    return json.loads(row["payload"])


def delete_student_draft(share_token: str, student_name: str) -> None:
    """Delete a saved student draft after successful submission."""
    if is_cloud_enabled():
        ok, _ = _try_cloud_call("delete_cloud_student_draft", delete_cloud_student_draft, share_token, student_name)
        if ok:
            return

    clean_name = student_name.strip()
    if not share_token.strip() or not clean_name:
        return
    with get_connection() as connection:
        connection.execute(
            """
            DELETE FROM student_drafts
            WHERE share_token = ? AND student_name = ?
            """,
            (share_token, clean_name),
        )


def create_student_group(
    *,
    owner_email: str,
    name: str,
    grade_level: str = "",
    description: str = "",
) -> int:
    """Create one teacher group or class."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "create_cloud_student_group",
            create_cloud_student_group,
            owner_email=owner_email,
            name=name,
            grade_level=grade_level,
            description=description,
        )
        if ok:
            return int(result)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO teacher_groups (owner_email, name, grade_level, description)
            VALUES (?, ?, ?, ?)
            """,
            (owner_email, name.strip(), grade_level.strip(), description.strip()),
        )
        return int(cursor.lastrowid)


def list_student_groups(owner_email: str) -> list[dict[str, Any]]:
    """List teacher groups."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("list_cloud_student_groups", list_cloud_student_groups, owner_email=owner_email)
        if ok:
            return result

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, owner_email, name, grade_level, description, created_at
            FROM teacher_groups
            WHERE owner_email = ?
            ORDER BY datetime(created_at) DESC, id DESC
            """,
            (owner_email,),
        ).fetchall()
    return [dict(row) for row in rows]


def save_group_student(
    *,
    owner_email: str,
    group_id: int,
    full_name: str,
    email: str = "",
    external_id: str = "",
    notes: str = "",
) -> int:
    """Add one student to a group."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "save_cloud_group_student",
            save_cloud_group_student,
            owner_email=owner_email,
            group_id=group_id,
            full_name=full_name,
            email=email,
            external_id=external_id,
            notes=notes,
        )
        if ok:
            return int(result)

    clean_name = full_name.strip()
    clean_email = email.strip().lower()
    with get_connection() as connection:
        existing = connection.execute(
            """
            SELECT id
            FROM teacher_group_students
            WHERE group_id = ? AND owner_email = ? AND LOWER(full_name) = ? AND LOWER(email) = ?
            LIMIT 1
            """,
            (group_id, owner_email, clean_name.lower(), clean_email),
        ).fetchone()
        if existing is not None:
            connection.execute(
                """
                UPDATE teacher_group_students
                SET external_id = ?, notes = ?
                WHERE id = ?
                """,
                (external_id.strip(), notes.strip(), int(existing["id"])),
            )
            return int(existing["id"])

        cursor = connection.execute(
            """
            INSERT INTO teacher_group_students (owner_email, group_id, full_name, email, external_id, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (owner_email, group_id, clean_name, clean_email, external_id.strip(), notes.strip()),
        )
        return int(cursor.lastrowid)


def import_group_students(
    *,
    owner_email: str,
    group_id: int,
    rows: list[dict[str, Any]],
) -> int:
    """Import multiple students into one group."""
    saved_count = 0
    for row in rows:
        full_name = str(row.get("full_name", "") or row.get("name", "")).strip()
        email = str(row.get("email", "")).strip().lower()
        if not full_name and not email:
            continue
        save_group_student(
            owner_email=owner_email,
            group_id=group_id,
            full_name=full_name or email,
            email=email,
            external_id=str(row.get("external_id", "") or row.get("student_id", "")).strip(),
            notes=str(row.get("notes", "")).strip(),
        )
        saved_count += 1
    return saved_count


def list_group_students(owner_email: str, group_id: int | None = None) -> list[dict[str, Any]]:
    """List imported roster students."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "list_cloud_group_students",
            list_cloud_group_students,
            owner_email=owner_email,
            group_id=group_id,
        )
        if ok:
            return result

    query = """
        SELECT
            s.id,
            s.owner_email,
            s.group_id,
            g.name AS group_name,
            g.grade_level,
            s.full_name,
            s.email,
            s.external_id,
            s.notes,
            s.created_at
        FROM teacher_group_students s
        LEFT JOIN teacher_groups g ON g.id = s.group_id
        WHERE s.owner_email = ?
    """
    params: list[Any] = [owner_email]
    if group_id is not None:
        query += " AND s.group_id = ?"
        params.append(group_id)
    query += " ORDER BY g.name ASC, LOWER(s.full_name) ASC"
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def log_api_error(provider: str, error_message: str, context: dict[str, Any] | None = None) -> int:
    """Store an API failure for later inspection."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("log_cloud_api_error", log_cloud_api_error, provider, error_message, context)
        if ok:
            return int(result)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO api_error_logs (provider, error_message, context_json)
            VALUES (?, ?, ?)
            """,
            (
                provider,
                error_message,
                json.dumps(context or {}, ensure_ascii=False),
            ),
        )
        return int(cursor.lastrowid)


def list_api_error_logs(limit: int = 30) -> list[dict[str, Any]]:
    """Return recent API failures."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("list_cloud_api_error_logs", list_cloud_api_error_logs, limit)
        if ok:
            return result

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, provider, error_message, context_json, created_at
            FROM api_error_logs
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item["context"] = json.loads(item.pop("context_json") or "{}")
        items.append(item)
    return items


def log_audit_event(
    actor_email: str,
    actor_role: str,
    event_type: str,
    target_type: str = "",
    target_id: str = "",
    details: dict[str, Any] | None = None,
) -> int:
    """Store one audit trail event."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call(
            "log_cloud_audit_event",
            log_cloud_audit_event,
            actor_email,
            actor_role,
            event_type,
            target_type,
            target_id,
            details,
        )
        if ok:
            return int(result)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO audit_logs (actor_email, actor_role, event_type, target_type, target_id, details_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                actor_email,
                actor_role,
                event_type,
                target_type,
                target_id,
                json.dumps(details or {}, ensure_ascii=False),
            ),
        )
        return int(cursor.lastrowid)


def list_audit_logs(limit: int = 100, actor_email: str | None = None) -> list[dict[str, Any]]:
    """Return recent audit events."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("list_cloud_audit_logs", list_cloud_audit_logs, limit=limit, actor_email=actor_email)
        if ok:
            return result

    query = """
        SELECT id, actor_email, actor_role, event_type, target_type, target_id, details_json, created_at
        FROM audit_logs
    """
    params: list[Any] = []
    if actor_email:
        query += " WHERE actor_email = ?"
        params.append(actor_email)
    query += " ORDER BY datetime(created_at) DESC, id DESC LIMIT ?"
    params.append(limit)
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["details"] = json.loads(item.pop("details_json") or "{}")
        items.append(item)
    return items


def record_usage_event(owner_email: str, event_type: str, quantity: int = 1, context: dict[str, Any] | None = None) -> int:
    """Store one usage event for billing/limits dashboards."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("record_cloud_usage_event", record_cloud_usage_event, owner_email, event_type, quantity, context)
        if ok:
            return int(result)

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO usage_events (owner_email, event_type, quantity, context_json)
            VALUES (?, ?, ?, ?)
            """,
            (owner_email, event_type, quantity, json.dumps(context or {}, ensure_ascii=False)),
        )
        return int(cursor.lastrowid)


def list_usage_events(limit: int = 200, owner_email: str | None = None) -> list[dict[str, Any]]:
    """Return recent usage events."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("list_cloud_usage_events", list_cloud_usage_events, limit=limit, owner_email=owner_email)
        if ok:
            return result

    query = """
        SELECT id, owner_email, event_type, quantity, context_json, created_at
        FROM usage_events
    """
    params: list[Any] = []
    if owner_email:
        query += " WHERE owner_email = ?"
        params.append(owner_email)
    query += " ORDER BY datetime(created_at) DESC, id DESC LIMIT ?"
    params.append(limit)
    with get_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["context"] = json.loads(item.pop("context_json") or "{}")
        items.append(item)
    return items


def get_plan_status(owner_email: str) -> dict[str, Any]:
    """Return current plan information and basic quotas for one teacher."""
    if is_cloud_enabled():
        ok, result = _try_cloud_call("get_cloud_plan_status", get_cloud_plan_status, owner_email)
        if ok:
            return result

    plan_name = "free"
    trial_ends_at = ""
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT plan_name, trial_ends_at, account_status
            FROM users
            WHERE email = ?
            LIMIT 1
            """,
            (owner_email,),
        ).fetchone()
    if row is not None:
        plan_name = row["plan_name"] or "free"
        trial_ends_at = row["trial_ends_at"] or ""
        account_status = row["account_status"] or "active"
    else:
        account_status = "active"

    limits = {
        "free": {"monthly_generations": 100, "students": 50, "active_tests": 100},
        "trial": {"monthly_generations": 200, "students": 150, "active_tests": 250},
        "teacher_pro": {"monthly_generations": 500, "students": 1000, "active_tests": 200},
        "school": {"monthly_generations": 5000, "students": 10000, "active_tests": 5000},
        "student": {"monthly_generations": 0, "students": 0, "active_tests": 0},
    }.get(plan_name, {"monthly_generations": 100, "students": 50, "active_tests": 100})
    usage_events = list_usage_events(limit=5000, owner_email=owner_email)
    monthly_generations = sum(item["quantity"] for item in usage_events if item["event_type"] == "generation")
    return {
        "plan_name": plan_name,
        "trial_ends_at": trial_ends_at,
        "account_status": account_status,
        "limits": limits,
        "usage": {"monthly_generations": monthly_generations},
    }


def migrate_local_data_to_cloud(owner_email: str) -> dict[str, int]:
    """Push local records for one teacher into Supabase when cloud mode is enabled."""
    if not is_cloud_enabled():
        return {"users": 0, "tests": 0, "attempts": 0, "groups": 0, "students": 0}
    ok, result = _try_cloud_call("sync_local_data_to_cloud", sync_local_data_to_cloud, DB_PATH, owner_email)
    if ok:
        return result
    return {"users": 0, "tests": 0, "attempts": 0, "groups": 0, "students": 0}
