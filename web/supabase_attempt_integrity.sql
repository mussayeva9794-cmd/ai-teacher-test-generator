-- Strict-mode integrity signals for student attempts.
--
-- Additive and idempotent: creates one table and one summary function; no
-- existing table, policy, or RPC changes. The web app writes and reads these
-- rows only with the server-side service role. Students and teachers have no
-- direct table access; teachers see aggregated counters through the results API
-- after the app checks test ownership.
--
-- Rollback: drop function public.web_attempt_integrity_summary(uuid);
--           drop table public.web_attempt_events;

create table if not exists public.web_attempt_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.web_share_links(id) on delete cascade,
  test_id uuid not null references public.web_tests(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('leave', 'return', 'paste', 'copy', 'question_shown', 'auto_submit')),
  question_id text check (question_id is null or char_length(question_id) <= 100),
  created_at timestamptz not null default now()
);

create index if not exists web_attempt_events_attempt
  on public.web_attempt_events (link_id, student_id, created_at);
create index if not exists web_attempt_events_test
  on public.web_attempt_events (test_id);
create index if not exists web_attempt_events_student
  on public.web_attempt_events (student_id);

alter table public.web_attempt_events enable row level security;
revoke all on table public.web_attempt_events from public, anon, authenticated;
grant select, insert on table public.web_attempt_events to service_role;

create or replace function public.web_attempt_integrity_summary(p_test_id uuid)
returns table (
  link_id uuid,
  student_id uuid,
  leaves integer,
  pastes integer,
  copies integer,
  auto_submitted boolean,
  away_seconds integer,
  question_seconds jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ordered as (
    select e.link_id, e.student_id, e.kind, e.question_id, e.created_at,
      lead(e.created_at) over w as next_at,
      lead(e.kind) over w as next_kind
    from public.web_attempt_events e
    where e.test_id = p_test_id
    window w as (partition by e.link_id, e.student_id order by e.created_at, e.id)
  ),
  shown as (
    select o.link_id, o.student_id, o.question_id,
      round(extract(epoch from (lead(o.created_at) over (
        partition by o.link_id, o.student_id order by o.created_at
      ) - o.created_at)))::integer as seconds
    from ordered o
    where o.kind = 'question_shown'
  ),
  per_question as (
    select s.link_id, s.student_id, jsonb_object_agg(s.question_id, s.seconds) as question_seconds
    from shown s
    where s.seconds is not null
    group by s.link_id, s.student_id
  )
  select o.link_id, o.student_id,
    (count(*) filter (where o.kind = 'leave'))::integer,
    (count(*) filter (where o.kind = 'paste'))::integer,
    (count(*) filter (where o.kind = 'copy'))::integer,
    coalesce(bool_or(o.kind = 'auto_submit'), false),
    coalesce(round(sum(extract(epoch from (o.next_at - o.created_at)))
      filter (where o.kind = 'leave' and o.next_kind = 'return')), 0)::integer,
    coalesce(p.question_seconds, '{}'::jsonb)
  from ordered o
  left join per_question p on p.link_id = o.link_id and p.student_id = o.student_id
  group by o.link_id, o.student_id, p.question_seconds;
$$;

revoke all on function public.web_attempt_integrity_summary(uuid) from public, anon, authenticated;
grant execute on function public.web_attempt_integrity_summary(uuid) to service_role;

-- Verification (read-only):
-- select relrowsecurity from pg_class where oid = 'public.web_attempt_events'::regclass;
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'web_attempt_events';
