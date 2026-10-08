-- AI Teacher school pilot: deny Data API access to unused legacy tables.
-- Apply only after a verified database backup and a final read-only audit.
-- This migration preserves all rows and grants no access to the current app,
-- which does not read or write these legacy tables.
do $migration$
declare
  table_name text;
  legacy_tables text[] := array[
    'app_users',
    'teacher_test_history',
    'teacher_question_bank',
    'teacher_attempts',
    'teacher_share_links',
    'teacher_student_drafts',
    'teacher_api_error_logs'
  ];
begin
  foreach table_name in array legacy_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format(
        'revoke all on table public.%I from public, anon, authenticated',
        table_name
      );
    end if;
  end loop;
end;
$migration$;
