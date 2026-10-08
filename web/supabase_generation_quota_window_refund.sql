-- Apply before deploying the generation route that calls these v2 RPCs.
-- Keep the deployed RPCs in place until all old application instances have drained.
create or replace function public.consume_web_generation_quota_v2()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  requester uuid := (select auth.uid());
  reserved_window timestamptz;
begin
  if requester is null or not exists (
    select 1 from public.web_profiles where id = requester and role = 'teacher'
  ) then
    return null;
  end if;

  delete from public.web_generation_quota
  where owner_id = requester and window_start < now() - interval '2 days';

  insert into public.web_generation_quota (owner_id, window_start, attempt_count)
  values (requester, date_trunc('hour', now()), 1)
  on conflict (owner_id, window_start) do update
    set attempt_count = public.web_generation_quota.attempt_count + 1
    where public.web_generation_quota.attempt_count < 5
  returning window_start into reserved_window;
  return reserved_window;
end;
$$;

revoke all on function public.consume_web_generation_quota_v2() from public, anon;
grant execute on function public.consume_web_generation_quota_v2() to authenticated;

create or replace function public.release_web_generation_quota_v2(p_owner_id uuid, p_window_start timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  reserved_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_owner_id is null or p_window_start is null or not exists (
    select 1 from public.web_profiles where id = p_owner_id and role = 'teacher'
  ) then
    raise exception 'teacher profile and reservation window required' using errcode = '42501';
  end if;

  select attempt_count into reserved_count
  from public.web_generation_quota
  where owner_id = p_owner_id and window_start = p_window_start
  for update;

  if reserved_count = 1 then
    delete from public.web_generation_quota
    where owner_id = p_owner_id and window_start = p_window_start;
  elsif reserved_count > 1 then
    update public.web_generation_quota
    set attempt_count = attempt_count - 1
    where owner_id = p_owner_id and window_start = p_window_start;
  end if;
end;
$$;

revoke all on function public.release_web_generation_quota_v2(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.release_web_generation_quota_v2(uuid, timestamptz) to service_role;
