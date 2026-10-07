#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  printf 'Set SUPABASE_DB_URL privately before running this script.\n' >&2
  exit 1
fi
if ! command -v supabase >/dev/null 2>&1; then
  printf 'Supabase CLI is required: https://supabase.com/docs/guides/local-development/cli/getting-started\n' >&2
  exit 1
fi

root="${1:-$HOME/AI-Teacher-Backups}"
mkdir -p "$root"
chmod 700 "$root"
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$"
target="$root/$stamp"
staging="$root/.incomplete-$stamp"
mkdir "$staging"

supabase db dump --db-url "$SUPABASE_DB_URL" -f "$staging/roles.sql" --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$staging/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$staging/data.sql" --use-copy --data-only \
  -x storage.buckets_vectors -x storage.vector_indexes
(
  cd "$staging"
  shasum -a 256 roles.sql schema.sql data.sql > SHA256SUMS
)
mv "$staging" "$target"
printf 'Backup saved to %s\n' "$target"
