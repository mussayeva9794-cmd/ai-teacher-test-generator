#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  printf 'Set SUPABASE_DB_URL privately before running this script.\n' >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  printf 'PostgreSQL client tools (pg_dump and pg_restore) are required.\n' >&2
  exit 1
fi

root="${1:-$HOME/AI-Teacher-Backups}"
mkdir -p "$root"
chmod 700 "$root"
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$"
target="$root/$stamp"
staging="$root/.incomplete-$stamp"
mkdir "$staging"
trap 'rm -f "$staging/.pgpass" "$staging/.safe-uri"' EXIT

export BACKUP_STAGING="$staging"
python3 - <<'PY'
import os
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

try:
    parsed = urlsplit(os.environ["SUPABASE_DB_URL"].strip())
    hostname = parsed.hostname
    port = parsed.port or 5432
except ValueError:
    raise SystemExit(
        "Invalid database URI. Replace [YOUR-PASSWORD] without brackets; "
        "URL-encode special characters in the password."
    ) from None
if parsed.scheme not in {"postgres", "postgresql"} or not hostname:
    raise SystemExit("Expected a PostgreSQL Session Pooler URI.")
if parsed.username is None or parsed.password is None:
    raise SystemExit("The connection URI must include its database username and password.")

host = hostname
if ":" in host and not host.startswith("["):
    host = f"[{host}]"
username = unquote(parsed.username)
password = unquote(parsed.password)
if host.endswith(".pooler.supabase.com") and "." not in username:
    raise SystemExit(
        "Shared Session Pooler requires a username like postgres.<project-ref>. "
        "Copy the Session pooler URI from Supabase Connect."
    )
database = unquote(parsed.path.lstrip("/")) or "postgres"
pass_fields = [host, str(port), database, username, password]
escaped = [field.replace("\\", "\\\\").replace(":", "\\:") for field in pass_fields]
staging = Path(os.environ["BACKUP_STAGING"])
passfile = staging / ".pgpass"
passfile.write_text(":".join(escaped) + "\n", encoding="utf-8")
passfile.chmod(0o600)

safe_netloc = quote(username, safe="") + "@" + host + f":{port}"
safe_uri = urlunsplit((parsed.scheme, safe_netloc, parsed.path or "/postgres", parsed.query, ""))
(staging / ".safe-uri").write_text(safe_uri, encoding="utf-8")
PY
export PGPASSFILE="$staging/.pgpass"
connection_uri="$(<"$staging/.safe-uri")"
pg_dump --dbname="$connection_uri" --format=custom --no-owner --schema=public --file "$staging/public.dump"
pg_restore --list "$staging/public.dump" >/dev/null
(
  cd "$staging"
  shasum -a 256 public.dump > SHA256SUMS
)
rm -f "$staging/.pgpass" "$staging/.safe-uri"
mv "$staging" "$target"
printf 'Backup saved to %s\n' "$target"
