-- Rollback for supabase_server_strict_progress.sql.
--
-- Removes the server-authoritative strict-mode tables, RPCs and trigger and
-- restores the previous web_attempt_integrity_summary from
-- supabase_attempt_integrity.sql. Deploy the matching app version first:
-- the app that calls these RPCs breaks strict mode once they are gone.
-- Deletes strict progress rows (current question, per-question windows);
-- drafts, attempts and integrity events are untouched.

begin;

drop trigger if exists web_close_strict_question_window_after_submit on public.web_attempts;
drop function if exists public.web_close_strict_question_window();
drop function if exists public.record_web_strict_event(uuid, uuid, uuid, text);
drop function if exists public.advance_web_strict_question(uuid, uuid, uuid);
drop function if exists public.save_web_strict_answer_if_open(uuid, uuid, uuid, text, jsonb);
drop function if exists public.start_or_load_web_strict_attempt(uuid, uuid, uuid, jsonb);
drop table if exists public.web_strict_question_windows;
drop table if exists public.web_strict_attempt_state;

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

commit;
