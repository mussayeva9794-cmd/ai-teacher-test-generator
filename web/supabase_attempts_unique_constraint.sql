-- AI Teacher: enforce one submitted attempt per test and student.
-- Forward-only, idempotent migration. Does not delete or rewrite any rows.
--
-- OPERATOR CHECKLIST:
-- 1. Take and verify a backup before applying any production DDL.
-- 2. Run supabase_school_production_audit.sql. Resolve every duplicate
--    deliberately and retain an audit trail; this migration never deletes data.
-- 3. Apply during a quiet period. The migration takes ACCESS EXCLUSIVE on
--    web_attempts while checking and adding the constraint to close the race
--    where a concurrent submission could create a duplicate after preflight.
--    This temporarily blocks reads/writes to that table. For a very large
--    table, use a reviewed CREATE UNIQUE INDEX CONCURRENTLY + attach procedure
--    instead; do not run this lock-based script without a maintenance window.
-- 4. Verify the resulting constraint and re-run the audit afterward.
--
-- EXPLICIT PREFLIGHT (read-only):
--   select test_id, student_id, count(*) as attempt_count,
--          array_agg(id order by submitted_at, id) as attempt_ids
--   from public.web_attempts
--   group by test_id, student_id
--   having count(*) > 1;
-- The query must return zero rows. The DO block repeats this check under lock.

do $migration$
declare
  table_oid oid := to_regclass('public.web_attempts');
  matching_constraint_exists boolean;
  conflicting_constraint_exists boolean;
  duplicate_pair_exists boolean;
begin
  if table_oid is null then
    raise exception
      'Cannot enforce one attempt: public.web_attempts does not exist. Apply and verify the web schema first.'
      using errcode = '42P01';
  end if;

  -- Serializes submissions against the preflight and DDL so no duplicate can
  -- slip between the duplicate check and constraint creation.
  lock table public.web_attempts in access exclusive mode;

  select exists (
    select 1
    from pg_constraint c
    where c.conrelid = table_oid
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by key_column.ordinality)
        from unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = key_column.attnum
      ) = array['test_id', 'student_id']::text[]
  ) into matching_constraint_exists;

  if matching_constraint_exists then
    raise notice 'Constraint on (test_id, student_id) already exists; no change made.';
    return;
  end if;

  select exists (
    select 1 from pg_constraint c
    where c.conrelid = table_oid
      and c.conname = 'web_attempts_test_id_student_id_key'
  ) into conflicting_constraint_exists;

  if conflicting_constraint_exists then
    raise exception
      'Constraint name web_attempts_test_id_student_id_key already exists with a different definition. Inspect pg_constraint; no data was changed.'
      using errcode = '42710';
  end if;

  select exists (
    select 1
    from public.web_attempts
    group by test_id, student_id
    having count(*) > 1
  ) into duplicate_pair_exists;

  if duplicate_pair_exists then
    raise exception
      'Cannot add one-attempt constraint: duplicate (test_id, student_id) rows exist in public.web_attempts. Run the read-only audit, resolve duplicates manually with an approved data-retention decision, then rerun. This migration deleted no rows.'
      using errcode = '23505';
  end if;

  alter table public.web_attempts
    add constraint web_attempts_test_id_student_id_key
    unique (test_id, student_id);

  raise notice 'Added UNIQUE (test_id, student_id) to public.web_attempts.';
end;
$migration$;
