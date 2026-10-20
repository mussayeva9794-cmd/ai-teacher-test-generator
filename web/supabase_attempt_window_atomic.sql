-- Apply to the staging project first, then the matching application release.
-- These service-only RPCs make the deadline/timer decision and persistence a
-- single database operation. They never remove or rewrite existing attempts.
-- Rollback: redeploy the prior application first. Keep save_web_draft_if_open and
-- finalize_web_attempt while that app still calls them. A rollback to the immediate
-- parent release may drop only start_web_draft_if_open; drop all three only after
-- confirming no active application version calls any of them.

begin;

create or replace function public.start_web_draft_if_open(
  p_link_id uuid,
  p_test_id uuid,
  p_student_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings jsonb;
  v_deadline timestamptz;
  v_test_status text;
  v_started_at timestamptz;
begin
  if p_link_id is null or p_test_id is null or p_student_id is null then
    return 'invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || ':' || p_student_id::text, 0));

  select l.settings, t.status
    into v_settings, v_test_status
  from public.web_share_links as l
  join public.web_tests as t on t.id = l.test_id and t.owner_id = l.owner_id
  where l.id = p_link_id and l.test_id = p_test_id and l.is_active
  for update of l, t;

  if not found or v_test_status <> 'published' then
    return 'unavailable';
  end if;
  if exists (
    select 1 from public.web_attempts as a
    where a.test_id = p_test_id and a.student_id = p_student_id
  ) then
    return 'submitted';
  end if;
  if exists (
    select 1 from public.web_drafts as d
    where d.link_id = p_link_id and d.student_id = p_student_id
  ) then
    return 'existing';
  end if;

  begin
    v_deadline := nullif(v_settings->>'deadline_at', '')::timestamptz;
  exception when others then
    return 'invalid_settings';
  end;
  if v_deadline is not null and clock_timestamp() >= v_deadline then
    return 'expired';
  end if;

  -- Repeat the cutoff check in the same statement that creates the draft.
  insert into public.web_drafts (link_id, student_id, answers, started_at, updated_at)
  select p_link_id, p_student_id, '{}'::jsonb, clock_timestamp(), clock_timestamp()
  where v_deadline is null or clock_timestamp() < v_deadline
  on conflict (link_id, student_id) do nothing
  returning started_at into v_started_at;

  if v_started_at is not null then
    return 'started';
  end if;
  if exists (
    select 1 from public.web_drafts as d
    where d.link_id = p_link_id and d.student_id = p_student_id
  ) then
    return 'existing';
  end if;
  return 'expired';
end;
$function$;

create or replace function public.save_web_draft_if_open(
  p_link_id uuid,
  p_test_id uuid,
  p_student_id uuid,
  p_answers jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings jsonb;
  v_deadline timestamptz;
  v_timer integer;
  v_test_id uuid;
  v_updated_at timestamptz;
begin
  if p_link_id is null or p_test_id is null or p_student_id is null
     or jsonb_typeof(p_answers) is distinct from 'object'
     or octet_length(p_answers::text) > 50000 then
    return 'invalid';
  end if;

  -- Serialize answer writes with finalization for this test/student pair.
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || ':' || p_student_id::text, 0));

  select l.settings, l.test_id
    into v_settings, v_test_id
  from public.web_share_links as l
  where l.id = p_link_id and l.is_active;
  if not found or v_test_id <> p_test_id then
    return 'unavailable';
  end if;

  begin
    v_deadline := nullif(v_settings->>'deadline_at', '')::timestamptz;
    v_timer := greatest(0, least(coalesce(nullif(v_settings->>'timer_minutes', '')::integer, 0), 240));
  exception when others then
    return 'invalid_settings';
  end;

  if exists (
    select 1 from public.web_attempts as a
    where a.test_id = p_test_id and a.student_id = p_student_id
  ) then
    return 'submitted';
  end if;

  -- The volatile database clock is tested in the UPDATE predicate itself,
  -- after Postgres obtains/rechecks the row lock.
  update public.web_drafts as d
  set answers = p_answers, updated_at = clock_timestamp()
  from public.web_share_links as l
  join public.web_tests as t on t.id = l.test_id and t.owner_id = l.owner_id
  where d.link_id = p_link_id
    and d.student_id = p_student_id
    and l.id = d.link_id
    and l.test_id = p_test_id
    and l.is_active
    and t.status = 'published'
    and (v_deadline is null or clock_timestamp() < v_deadline)
    and (v_timer = 0 or d.started_at + make_interval(mins => v_timer) > clock_timestamp())
    and not exists (
      select 1 from public.web_attempts as a
      where a.test_id = p_test_id and a.student_id = p_student_id
    )
  returning d.updated_at into v_updated_at;

  if v_updated_at is not null then
    return 'saved';
  end if;
  if exists (
    select 1 from public.web_attempts as a
    where a.test_id = p_test_id and a.student_id = p_student_id
  ) then
    return 'submitted';
  end if;
  if not exists (
    select 1
    from public.web_share_links as l
    join public.web_tests as t on t.id = l.test_id and t.owner_id = l.owner_id
    where l.id = p_link_id and l.test_id = p_test_id
      and l.is_active and t.status = 'published'
  ) then
    return 'unavailable';
  end if;
  if not exists (
    select 1 from public.web_drafts as d
    where d.link_id = p_link_id and d.student_id = p_student_id
  ) then
    return 'missing';
  end if;
  return 'expired';
end;
$function$;

create or replace function public.finalize_web_attempt(
  p_link_id uuid,
  p_test_id uuid,
  p_student_id uuid,
  p_expected_draft_updated_at timestamptz,
  p_expected_draft_answers jsonb,
  p_current_answers jsonb,
  p_current_percentage numeric,
  p_current_result jsonb,
  p_saved_answers jsonb,
  p_saved_percentage numeric,
  p_saved_result jsonb
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
  v_started_at timestamptz;
  v_draft_updated_at timestamptz;
  v_draft_answers jsonb;
  v_link_active boolean;
  v_variant_name text;
  v_status text;
  v_now timestamptz;
  v_expired boolean;
  v_answers jsonb;
  v_percentage numeric;
  v_result jsonb;
  v_attempt_id uuid;
begin
  if p_link_id is null or p_test_id is null or p_student_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Different share links for one test still represent the same one-attempt
  -- identity; serialize those finalizers before the unique insert.
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text || ':' || p_student_id::text, 0));

  select l.settings, l.is_active, l.variant_name, t.status,
         d.started_at, d.updated_at, d.answers
    into v_settings, v_link_active, v_variant_name, v_status,
         v_started_at, v_draft_updated_at, v_draft_answers
  from public.web_share_links as l
  join public.web_tests as t on t.id = l.test_id and t.owner_id = l.owner_id
  join public.web_drafts as d on d.link_id = l.id and d.student_id = p_student_id
  where l.id = p_link_id and l.test_id = p_test_id
  for update of l, t, d;

  if not found then
    return jsonb_build_object('status', 'missing');
  end if;
  if not v_link_active or v_status <> 'published' then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_draft_updated_at is distinct from p_expected_draft_updated_at
     or v_draft_answers is distinct from p_expected_draft_answers then
    return jsonb_build_object('status', 'draft_changed');
  end if;

  begin
    v_deadline := nullif(v_settings->>'deadline_at', '')::timestamptz;
    v_timer := greatest(0, least(coalesce(nullif(v_settings->>'timer_minutes', '')::integer, 0), 240));
  exception when others then
    return jsonb_build_object('status', 'invalid_settings');
  end;

  v_now := clock_timestamp();
  v_expired := (v_deadline is not null and v_now >= v_deadline)
    or (v_timer > 0 and v_now >= v_started_at + make_interval(mins => v_timer));

  if exists (
    select 1 from public.web_attempts as a
    where a.test_id = p_test_id and a.student_id = p_student_id
  ) then
    return jsonb_build_object('status', 'already_submitted');
  end if;

  if not v_expired then
    if jsonb_typeof(p_current_answers) is distinct from 'object'
       or octet_length(p_current_answers::text) > 50000
       or p_current_result is null then
      return jsonb_build_object('status', 'invalid_answers');
    end if;
    v_answers := p_current_answers;
    v_percentage := p_current_percentage;
    v_result := p_current_result;
    -- Re-evaluate the database cutoff in the persistence statement itself.
    -- If it elapsed after the initial decision, use the unchanged saved draft.
    update public.web_drafts as d
      set answers = v_answers, updated_at = clock_timestamp()
    where d.link_id = p_link_id and d.student_id = p_student_id
      and (v_deadline is null or clock_timestamp() < v_deadline)
      and (v_timer = 0 or d.started_at + make_interval(mins => v_timer) > clock_timestamp())
    returning d.updated_at into v_draft_updated_at;
    if v_draft_updated_at is null then
      v_expired := true;
    end if;
  end if;

  if v_expired then
    if jsonb_typeof(p_saved_answers) is distinct from 'object'
       or p_saved_result is null then
      return jsonb_build_object('status', 'invalid_saved_draft');
    end if;
    v_answers := p_saved_answers;
    v_percentage := p_saved_percentage;
    v_result := p_saved_result;
  end if;

  insert into public.web_attempts (
    test_id, link_id, student_id, variant_name, answers, percentage, result
  ) values (
    p_test_id, p_link_id, p_student_id, v_variant_name,
    v_answers, v_percentage, v_result
  ) on conflict (test_id, student_id) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null then
    return jsonb_build_object('status', 'already_submitted');
  end if;

  return jsonb_build_object(
    'status', 'submitted',
    'expired', v_expired,
    'percentage', v_percentage
  );
end;
$function$;

revoke all on function public.save_web_draft_if_open(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_web_draft_if_open(uuid, uuid, uuid, jsonb)
  to service_role;

revoke all on function public.start_web_draft_if_open(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.start_web_draft_if_open(uuid, uuid, uuid)
  to service_role;

revoke all on function public.finalize_web_attempt(uuid, uuid, uuid, timestamptz, jsonb, jsonb, numeric, jsonb, jsonb, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_web_attempt(uuid, uuid, uuid, timestamptz, jsonb, jsonb, numeric, jsonb, jsonb, numeric, jsonb)
  to service_role;

commit;
