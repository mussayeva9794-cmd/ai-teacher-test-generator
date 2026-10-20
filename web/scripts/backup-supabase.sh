#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Paste Supabase Session Pooler URI (input hidden): " SUPABASE_DB_URL
    printf '\n'
    if [[ -z "$SUPABASE_DB_URL" ]]; then
      printf 'A database URI is required.\n' >&2
      exit 1
    fi
    export SUPABASE_DB_URL
  else
    printf 'Set SUPABASE_DB_URL privately or run this script in an interactive terminal.\n' >&2
    exit 1
  fi
fi
pg_dump_bin="${PG_DUMP_BIN:-$(command -v pg_dump || true)}"
pg_restore_bin="${PG_RESTORE_BIN:-$(command -v pg_restore || true)}"
if [[ -z "$pg_dump_bin" || ! -x "$pg_dump_bin" || -z "$pg_restore_bin" || ! -x "$pg_restore_bin" ]]; then
  printf 'PostgreSQL client tools (pg_dump and pg_restore) are required.\n' >&2
  exit 1
fi

dump_version="$($pg_dump_bin --version)"
restore_version="$($pg_restore_bin --version)"
if [[ "$dump_version" =~ ([0-9]+)\.[0-9]+ ]]; then
  dump_major="${BASH_REMATCH[1]}"
else
  printf 'Could not determine pg_dump version.\n' >&2
  exit 1
fi
if [[ "$restore_version" =~ ([0-9]+)\.[0-9]+ ]]; then
  restore_major="${BASH_REMATCH[1]}"
else
  printf 'Could not determine pg_restore version.\n' >&2
  exit 1
fi
if (( dump_major < 17 )); then
  printf 'Supabase is PostgreSQL 17.6; pg_dump 17 or newer is required (found %s).\n' "$dump_version" >&2
  printf 'Set PG_DUMP_BIN and PG_RESTORE_BIN to matching PostgreSQL client binaries.\n' >&2
  exit 1
fi
if (( dump_major != restore_major )); then
  printf 'Use matching pg_dump and pg_restore major versions (found %s and %s).\n' "$dump_version" "$restore_version" >&2
  exit 1
fi
printf 'Using %s and %s.\n' "$dump_version" "$restore_version"

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
"$pg_dump_bin" --dbname="$connection_uri" --format=custom --no-owner --schema=public --file "$staging/public.dump"
"$pg_restore_bin" --list "$staging/public.dump" >/dev/null
(
  cd "$staging"
  shasum -a 256 public.dump > SHA256SUMS
)
rm -f "$staging/.pgpass" "$staging/.safe-uri"
mv "$staging" "$target"
printf 'Backup saved to %s\n' "$target"
