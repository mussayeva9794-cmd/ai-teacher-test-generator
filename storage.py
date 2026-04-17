"""SQLite helpers for users, history, attempts, question bank, and share links."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
from pathlib import Path
from typing import Any


DB_PATH = Path(__file__).resolve().parent / "teacher_history.db"


def get_connection() -> sqlite3.Connection:
    """Create a database connection."""
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    return connection


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
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
                student_name TEXT NOT NULL,
                test_uid TEXT DEFAULT '',
                variant_name TEXT NOT NULL,
                test_title TEXT NOT NULL,
                owner_email TEXT DEFAULT '',
                share_token TEXT DEFAULT '',
                submission_key TEXT DEFAULT '',
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
        ensure_column(connection, "test_attempts", "submission_key", "TEXT DEFAULT ''")

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
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")


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
    if role not in {"teacher", "student"}:
        return False, "Role must be teacher or student."

    try:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO users (email, display_name, password_hash, role)
                VALUES (?, ?, ?, ?)
                """,
                (email, display_name, hash_password(password), role),
            )
    except sqlite3.IntegrityError:
        return False, "A user with this email already exists."

    return True, "Profile created successfully."


def authenticate_local_user(email: str, password: str) -> dict[str, Any] | None:
    """Authenticate a local user."""
    email = email.strip().lower()
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT email, display_name, password_hash, role
            FROM users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()

    if row is None or not verify_password(password, row["password_hash"]):
        return None

    return {
        "email": row["email"],
        "display_name": row["display_name"],
        "role": row["role"],
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
    test_uid: str,
    variant_name: str,
    test_title: str,
    owner_email: str,
    share_token: str,
    submission_key: str = "",
    percentage: float,
    payload: dict[str, Any],
) -> int:
    """Save a student attempt."""
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO test_attempts (
                student_name,
                test_uid,
                variant_name,
                test_title,
                owner_email,
                share_token,
                submission_key,
                percentage,
                payload
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                student_name,
                test_uid,
                variant_name,
                test_title,
                owner_email,
                share_token,
                submission_key,
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
    query = """
        SELECT
            id,
            student_name,
            test_uid,
            variant_name,
            test_title,
            owner_email,
            share_token,
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


def count_share_attempts(token: str, student_name: str = "") -> int:
    """Count attempts for a share link, optionally scoped to one student."""
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


def attempt_submission_exists(submission_key: str) -> bool:
    """Return whether this submission fingerprint already exists."""
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


def log_api_error(provider: str, error_message: str, context: dict[str, Any] | None = None) -> int:
    """Store an API failure for later inspection."""
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
