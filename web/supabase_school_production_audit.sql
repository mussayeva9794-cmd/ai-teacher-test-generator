-- AI Teacher: read-only production preflight audit.
-- Run in the Supabase SQL Editor against the intended project before applying
-- supabase_attempts_unique_constraint.sql. Every statement below is SELECT-only.
-- Results can include user emails and policy definitions; keep them private.

-- 1) Duplicate attempts that would block the one-attempt constraint.
-- An empty result is required before the constraint migration can succeed.
select
  test_id,
  student_id,
  count(*) as attempt_count,
  array_agg(id order by submitted_at, id) as attempt_ids,
  min(submitted_at) as first_submitted_at,
  max(submitted_at) as last_submitted_at
from public.web_attempts
group by test_id, student_id
having count(*) > 1
order by attempt_count desc, test_id, student_id;

-- 2) Unique constraints and indexes currently enforcing attempt uniqueness.
-- This distinguishes a table constraint from a standalone unique index.
select
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid) as constraint_definition,
  c.convalidated as is_validated
from pg_constraint c
where c.conrelid = to_regclass('public.web_attempts')
  and c.contype = 'u'
order by c.conname;

select
  i.indexname,
  i.indexdef
from pg_indexes i
where i.schemaname = 'public'
  and i.tablename = 'web_attempts'
  and i.indexdef ilike '%unique%'
order by i.indexname;

-- 3) RLS state, FORCE RLS state, policies, and table grants for every current
-- web_* table and the legacy table names/prefixes found in this repository.
-- Add any school-specific legacy tables to the name filter before relying on
-- this inventory as a complete audit.
with audited_tables as (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    c.relkind,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (
      left(c.relname, 4) = 'web_'
      or left(c.relname, 8) = 'teacher_'
      or c.relname in (
        'app_users', 'schema_meta',
        'users', 'test_history', 'question_bank', 'test_attempts',
        'student_drafts', 'api_error_logs', 'audit_logs', 'usage_events',
        'share_links'
      )
    )
)
select
  t.schema_name,
  t.table_name,
  t.rls_enabled,
  t.force_rls,
  coalesce(p.policies, '[]'::jsonb) as policies,
  coalesce(g.grants, '[]'::jsonb) as grants
from audited_tables t
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'name', pol.policyname,
    'command', pol.cmd,
    'permissive', pol.permissive,
    'roles', pol.roles,
    'using', pol.qual,
    'with_check', pol.with_check
  ) order by pol.policyname) as policies
  from pg_policies pol
  where pol.schemaname = t.schema_name
    and pol.tablename = t.table_name
) p on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'grantee', tp.grantee,
    'privilege', tp.privilege_type,
    'grantable', tp.is_grantable
  ) order by tp.grantee, tp.privilege_type) as grants
  from information_schema.table_privileges tp
  where tp.table_schema = t.schema_name
    and tp.table_name = t.table_name
) g on true
order by t.table_name;

-- 4) Teacher profile roles and signup metadata.
-- Investigate every teacher role; user_metadata is not authoritative for access.
select
  u.id as user_id,
  u.email,
  u.created_at as auth_created_at,
  u.raw_user_meta_data ->> 'role' as signup_metadata_role,
  p.role as profile_role,
  p.display_name,
  p.created_at as profile_created_at
from auth.users u
left join public.web_profiles p on p.id = u.id
order by u.created_at desc;

-- 5) Profile creation trigger/function status on auth.users.
select
  tr.tgname as trigger_name,
  tr.tgenabled as trigger_enabled_state,
  fn_ns.nspname as function_schema,
  fn.proname as function_name,
  fn.prosecdef as security_definer,
  fn.proconfig as function_settings,
  pg_get_functiondef(fn.oid) as function_definition,
  pg_get_triggerdef(tr.oid) as trigger_definition
from pg_trigger tr
join pg_class tbl on tbl.oid = tr.tgrelid
join pg_namespace tbl_ns on tbl_ns.oid = tbl.relnamespace
join pg_proc fn on fn.oid = tr.tgfoid
join pg_namespace fn_ns on fn_ns.oid = fn.pronamespace
where tbl_ns.nspname = 'auth'
  and tbl.relname = 'users'
  and not tr.tgisinternal
  and (tr.tgname = 'on_web_auth_user_created' or fn.proname = 'create_web_profile')
order by tr.tgname;

-- 6) Profiles without an auth user / auth users without a profile (integrity).
select
  (select count(*) from public.web_profiles p
   left join auth.users u on u.id = p.id where u.id is null) as orphan_profiles,
  (select count(*) from auth.users u
   left join public.web_profiles p on p.id = u.id where p.id is null) as users_without_profile;
