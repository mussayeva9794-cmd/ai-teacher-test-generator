-- Server-authoritative strict-mode progression.
--
-- Apply after supabase_attempt_window_atomic.sql and
-- supabase_attempt_integrity.sql. This migration is additive: it does not
-- modify existing drafts or attempts. The application uses these RPCs only
-- with the service role after authenticating the student itself.

begin;

create table if not exists public.web_strict_attempt_state (
  link_id uuid not null references public.web_share_links(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null references public.web_tests(id) on delete cascade,
  question_ids jsonb not null,
  current_index integer not null default 0 check (current_index >= 0),
  question_started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (link_id, student_id)
);

create index if not exists web_strict_attempt_state_test
  on public.web_strict_attempt_state (test_id, student_id);

create table if not exists public.web_strict_question_windows (
  link_id uuid not null references public.web_share_links(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  test_id uuid not null references public.web_tests(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  question_id text not null check (char_length(question_id) between 1 and 100),
  started_at timestamptz not null,
  ended_at timestamptz,
  primary key (link_id, student_id, question_index)
);

create index if not exists web_strict_question_windows_test
  on public.web_strict_question_windows (test_id, student_id, question_index);

alter table public.web_strict_attempt_state enable row level security;
alter table public.web_strict_question_windows enable row level security;
revoke all on table public.web_strict_attempt_state, public.web_strict_question_windows
  from public, anon, authenticated;
grant select, insert, update, delete on table public.web_strict_attempt_state,
  public.web_strict_question_windows to service_role;

create or replace function public.start_or_load_web_strict_attempt(
  p_link_id uuid,
  p_test_id uuid,
  p_student_id uuid,
  p_question_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings jsonb;
  v_status text;
  v_ids jsonb;
  v_index integer;
  v_started_at timestamptz;
  v_finished_at timestamptz;
  v_now timestamptz;
begin
  if p_link_id is null or p_test_id is null or p_student_id is null
     or jsonb_typeof(p_question_ids) is distinct from 'array'
     or jsonb_array_length(p_question_ids) = 0
     or jsonb_array_length(p_question_ids) > 50
     or exists (
       select 1 from jsonb_array_elements_text(p_question_ids) as q(question_id)
       where char_length(q.question_id) = 0 or char_length(q.question_id) > 100
     )
     or exists (
       select q.question_id
       from jsonb_array_elements_text(p_question_ids) as q(question_id)
       group by q.question_id having count(*) > 1
     ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || ':' || p_student_id::text, 0));

  select l.settings, t.status
    into v_settings, v_status
  from public.web_share_links as l
  join public.web_tests as t on t.id = l.test_id and t.owner_id = l.owner_id
  where l.id = p_link_id and l.test_id = p_test_id and l.is_active
  for update of l, t;
  if not found or v_status <> 'published' or coalesce((v_settings->>'strict_mode')::boolean, false) is not true then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if exists (
    select 1 from public.web_attempts as a
    where a.test_id = p_test_id and a.student_id = p_student_id
  ) then
    return jsonb_build_object('status', 'submitted');
  end if;
  if not exists (
    select 1 from public.web_drafts as d
    where d.link_id = p_link_id and d.student_id = p_student_id
  ) then
    return jsonb_build_object('status', 'missing');
  end if;

  select s.question_ids, s.current_index, s.question_started_at, s.finished_at
    into v_ids, v_index, v_started_at, v_finished_at
  from public.web_strict_attempt_state as s
  where s.link_id = p_link_id and s.student_id = p_student_id
  for update;
  if found then
    if v_ids is distinct from p_question_ids then
      return jsonb_build_object('status', 'order_mismatch');
    end if;
    return jsonb_build_object(
      'status', 'ready', 'current_index', v_index,
      'question_started_at', v_started_at, 'finished', v_finished_at is not null,
      'server_now', clock_timestamp()
    );
  end if;

  v_now := clock_timestamp();
  insert into public.web_strict_attempt_state (
    link_id, student_id, test_id, question_ids, current_index, question_started_at, created_at, updated_at
  ) values (
    p_link_id, p_student_id, p_test_id, p_question_ids, 0, v_now, v_now, v_now
  );
  insert into public.web_strict_question_windows (
    link_id, student_id, test_id, question_index, question_id, started_at
  ) values (
    p_link_id, p_student_id, p_test_id, 0, p_question_ids ->> 0, v_now
  );
  return jsonb_build_object(
    'status', 'ready', 'current_index', 0,
    'question_started_at', v_now, 'finished', false, 'server_now', v_now
  );
end;
$function$;

create or replace function public.save_web_strict_answer_if_open(
  p_link_id uuid,
  p_test_id uuid,
  p_student_id uuid,
  p_question_id text,
  p_answer jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings jsonb;
  v_deadline timestamptz;
  v_timer integer;
  v_question_seconds integer;
  v_index integer;
  v_ids jsonb;
  v_question_started_at timestamptz;
  v_finished_at timestamptz;
  v_saved_at timestamptz;
begin
  if p_link_id is null or p_test_id is null or p_student_id is null
     or p_question_id is null or char_length(p_question_id) not between 1 and 100 then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || ':' || p_student_id::text, 0));

  select l.settings into v_settings
  from public.web_share_links as l
  join public.web_tests as t on t.id = l.test_id and t.owner_id = l.owner_id
  where l.id = p_link_id and l.test_id = p_test_id and l.is_active and t.status = 'published'
  for update of l, t;
  if not found or coalesce((v_settings->>'strict_mode')::boolean, false) is not true then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if exists (select 1 from public.web_attempts a where a.test_id = p_test_id and a.student_id = p_student_id) then
    return jsonb_build_object('status', 'submitted');
  end if;
  select s.current_index, s.question_ids, s.question_started_at, s.finished_at
    into v_index, v_ids, v_question_started_at, v_finished_at
  from public.web_strict_attempt_state as s
  where s.link_id = p_link_id and s.student_id = p_student_id
  for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if v_finished_at is not null then return jsonb_build_object('status', 'finished'); end if;
  if v_ids ->> v_index is distinct from p_question_id then
    return jsonb_build_object('status', 'wrong_question');
  end if;

  begin
    v_deadline := nullif(v_settings->>'deadline_at', '')::timestamptz;
    v_timer := greatest(0, least(coalesce(nullif(v_settings->>'timer_minutes', '')::integer, 0), 240));
    v_question_seconds := greatest(0, least(coalesce(nullif(v_settings->>'question_seconds', '')::integer, 0), 600));
  exception when others then
    return jsonb_build_object('status', 'invalid_settings');
  end;
  if (v_deadline is not null and clock_timestamp() >= v_deadline)
     or (v_timer > 0 and exists (
       select 1 from public.web_drafts d where d.link_id = p_link_id and d.student_id = p_student_id
         and d.started_at + make_interval(mins => v_timer) <= clock_timestamp()
     )) then
    return jsonb_build_object('status', 'expired');
  end if;
  if v_question_seconds > 0 and clock_timestamp() >= v_question_started_at + make_interval(secs => v_question_seconds) then
    return jsonb_build_object('status', 'question_expired');
  end if;

  update public.web_drafts as d
  set answers = d.answers || jsonb_build_object(p_question_id, p_answer), updated_at = clock_timestamp()
  where d.link_id = p_link_id and d.student_id = p_student_id
  returning d.updated_at into v_saved_at;
  if v_saved_at is null then return jsonb_build_object('status', 'missing'); end if;
  return jsonb_build_object('status', 'saved', 'saved_at', v_saved_at);
end;
$function$;

create or replace function public.advance_web_strict_question(
  p_link_id uuid,
  p_test_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings jsonb;
  v_deadline timestamptz;
  v_timer integer;
  v_question_seconds integer;
  v_index integer;
  v_ids jsonb;
  v_question_started_at timestamptz;
  v_finished_at timestamptz;
  v_now timestamptz;
begin
  if p_link_id is null or p_test_id is null or p_student_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || ':' || p_student_id::text, 0));

  select l.settings into v_settings
  from public.web_share_links as l
  join public.web_tests as t on t.id = l.test_id and t.owner_id = l.owner_id
  where l.id = p_link_id and l.test_id = p_test_id and l.is_active and t.status = 'published'
  for update of l, t;
  if not found or coalesce((v_settings->>'strict_mode')::boolean, false) is not true then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if exists (select 1 from public.web_attempts a where a.test_id = p_test_id and a.student_id = p_student_id) then
    return jsonb_build_object('status', 'submitted');
  end if;
  select s.current_index, s.question_ids, s.question_started_at, s.finished_at
    into v_index, v_ids, v_question_started_at, v_finished_at
  from public.web_strict_attempt_state as s
  where s.link_id = p_link_id and s.student_id = p_student_id
  for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if v_finished_at is not null then
    return jsonb_build_object('status', 'finished', 'current_index', v_index, 'server_now', clock_timestamp());
  end if;

  begin
    v_deadline := nullif(v_settings->>'deadline_at', '')::timestamptz;
    v_timer := greatest(0, least(coalesce(nullif(v_settings->>'timer_minutes', '')::integer, 0), 240));
    v_question_seconds := greatest(0, least(coalesce(nullif(v_settings->>'question_seconds', '')::integer, 0), 600));
  exception when others then
    return jsonb_build_object('status', 'invalid_settings');
  end;
  if (v_deadline is not null and clock_timestamp() >= v_deadline)
     or (v_timer > 0 and exists (
       select 1 from public.web_drafts d where d.link_id = p_link_id and d.student_id = p_student_id
         and d.started_at + make_interval(mins => v_timer) <= clock_timestamp()
     )) then
    return jsonb_build_object('status', 'expired');
  end if;
  if v_question_seconds > 0 and clock_timestamp() < v_question_started_at + make_interval(secs => v_question_seconds) then
    return jsonb_build_object('status', 'not_ready', 'current_index', v_index, 'question_started_at', v_question_started_at, 'server_now', clock_timestamp());
  end if;

  v_now := clock_timestamp();
  update public.web_strict_question_windows
  set ended_at = coalesce(ended_at, v_now)
  where link_id = p_link_id and student_id = p_student_id and question_index = v_index;

  if v_index + 1 >= jsonb_array_length(v_ids) then
    update public.web_strict_attempt_state
    set finished_at = v_now, updated_at = v_now
    where link_id = p_link_id and student_id = p_student_id;
    return jsonb_build_object('status', 'finished', 'current_index', v_index, 'server_now', v_now);
  end if;

  update public.web_strict_attempt_state
  set current_index = v_index + 1, question_started_at = v_now, updated_at = v_now
  where link_id = p_link_id and student_id = p_student_id;
  insert into public.web_strict_question_windows (
    link_id, student_id, test_id, question_index, question_id, started_at
  ) values (
    p_link_id, p_student_id, p_test_id, v_index + 1, v_ids ->> (v_index + 1), v_now
  ) on conflict (link_id, student_id, question_index) do nothing;
  return jsonb_build_object(
    'status', 'advanced', 'current_index', v_index + 1,
    'question_started_at', v_now, 'server_now', v_now
  );
end;
$function$;

create or replace function public.record_web_strict_event(
  p_link_id uuid,
  p_test_id uuid,
  p_student_id uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings jsonb;
  v_events integer;
  v_leaves integer;
  v_limit integer;
begin
  if p_link_id is null or p_test_id is null or p_student_id is null
     or p_kind not in ('leave', 'return', 'paste', 'copy') then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || ':' || p_student_id::text, 0));
  select l.settings into v_settings
  from public.web_share_links l
  join public.web_tests t on t.id = l.test_id and t.owner_id = l.owner_id
  where l.id = p_link_id and l.test_id = p_test_id and l.is_active and t.status = 'published'
  for update of l, t;
  if not found or coalesce((v_settings->>'strict_mode')::boolean, false) is not true then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if not exists (select 1 from public.web_drafts d where d.link_id = p_link_id and d.student_id = p_student_id) then
    return jsonb_build_object('status', 'missing');
  end if;
  if exists (select 1 from public.web_attempts a where a.test_id = p_test_id and a.student_id = p_student_id) then
    return jsonb_build_object('status', 'submitted');
  end if;
  select count(*)::integer, count(*) filter (where kind = 'leave')::integer
    into v_events, v_leaves
  from public.web_attempt_events
  where link_id = p_link_id and student_id = p_student_id;
  if v_events >= 1000 then return jsonb_build_object('status', 'rate_limited'); end if;
  insert into public.web_attempt_events (link_id, test_id, student_id, kind, question_id)
  values (p_link_id, p_test_id, p_student_id, p_kind, null);
  v_events := v_events + 1;
  if p_kind = 'leave' then v_leaves := v_leaves + 1; end if;
  begin
    v_limit := nullif(v_settings->>'leave_limit', '')::integer;
  exception when others then
    v_limit := 2;
  end;
  return jsonb_build_object(
    'status', 'recorded', 'events', v_events, 'leaves', v_leaves,
    'locked', v_limit is not null and v_leaves > greatest(0, least(v_limit, 5)),
    'server_now', clock_timestamp()
  );
end;
$function$;

create or replace function public.web_close_strict_question_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.web_strict_question_windows
  set ended_at = coalesce(ended_at, new.submitted_at)
  where link_id = new.link_id and student_id = new.student_id and ended_at is null;
  return new;
end;
$function$;

drop trigger if exists web_close_strict_question_window_after_submit on public.web_attempts;
create trigger web_close_strict_question_window_after_submit
after insert on public.web_attempts
for each row execute function public.web_close_strict_question_window();

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
  with event_ordered as (
    select e.link_id, e.student_id, e.kind, e.question_id, e.created_at,
      lead(e.created_at) over w as next_at,
      lead(e.kind) over w as next_kind
    from public.web_attempt_events e
    where e.test_id = p_test_id
    window w as (partition by e.link_id, e.student_id order by e.created_at, e.id)
  ), event_totals as (
    select e.link_id, e.student_id,
      count(*) filter (where e.kind = 'leave')::integer as leaves,
      count(*) filter (where e.kind = 'paste')::integer as pastes,
      count(*) filter (where e.kind = 'copy')::integer as copies,
      coalesce(bool_or(e.kind = 'auto_submit'), false) as auto_submitted,
      coalesce(round(sum(extract(epoch from (e.next_at - e.created_at)))
        filter (where e.kind = 'leave' and e.next_kind = 'return')), 0)::integer as away_seconds
    from event_ordered e
    group by e.link_id, e.student_id
  ), question_totals as (
    select w.link_id, w.student_id,
      jsonb_object_agg(w.question_id,
        greatest(0, round(extract(epoch from (coalesce(w.ended_at, a.submitted_at, w.started_at) - w.started_at)))::integer)
      ) as question_seconds
    from public.web_strict_question_windows w
    left join public.web_attempts a
      on a.test_id = w.test_id and a.link_id = w.link_id and a.student_id = w.student_id
    where w.test_id = p_test_id
    group by w.link_id, w.student_id
  ), legacy_shown as (
    -- Keep timing details visible for attempts completed before the
    -- server-authoritative migration. New attempts use strict windows above.
    select e.link_id, e.student_id, e.question_id,
      round(extract(epoch from (lead(e.created_at) over (
        partition by e.link_id, e.student_id order by e.created_at
      ) - e.created_at)))::integer as seconds
    from event_ordered e
    where e.kind = 'question_shown'
  ), legacy_question_totals as (
    select s.link_id, s.student_id, jsonb_object_agg(s.question_id, s.seconds) as question_seconds
    from legacy_shown s
    where s.seconds is not null
    group by s.link_id, s.student_id
  )
  select a.link_id, a.student_id,
    coalesce(e.leaves, 0), coalesce(e.pastes, 0), coalesce(e.copies, 0),
    coalesce(e.auto_submitted, false), coalesce(e.away_seconds, 0),
    coalesce(q.question_seconds, legacy.question_seconds, '{}'::jsonb)
  from public.web_attempts a
  left join event_totals e on e.link_id = a.link_id and e.student_id = a.student_id
  left join question_totals q on q.link_id = a.link_id and q.student_id = a.student_id
  left join legacy_question_totals legacy on legacy.link_id = a.link_id and legacy.student_id = a.student_id
  where a.test_id = p_test_id;
$$;

revoke all on function public.start_or_load_web_strict_attempt(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_web_strict_answer_if_open(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.advance_web_strict_question(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.record_web_strict_event(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.web_close_strict_question_window()
  from public, anon, authenticated;
revoke all on function public.web_attempt_integrity_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.start_or_load_web_strict_attempt(uuid, uuid, uuid, jsonb),
  public.save_web_strict_answer_if_open(uuid, uuid, uuid, text, jsonb),
  public.advance_web_strict_question(uuid, uuid, uuid),
  public.record_web_strict_event(uuid, uuid, uuid, text),
  public.web_attempt_integrity_summary(uuid) to service_role;

commit;
