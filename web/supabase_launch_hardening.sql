-- Run in Supabase SQL Editor after supabase_v2.sql. Safe to re-run; existing teacher profiles remain unchanged.
-- Existing share links intentionally keep a NULL snapshot and use the live variant for compatibility.
alter table public.web_share_links
  add column if not exists variant_snapshot jsonb;

create or replace function public.create_web_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.web_profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)),
    'student'
  ) on conflict (id) do nothing;
  return new;
end;
$$;

create table if not exists public.web_generation_quota (
  owner_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  attempt_count integer not null check (attempt_count between 1 and 5),
  primary key (owner_id, window_start)
);
alter table public.web_generation_quota enable row level security;
revoke all on public.web_generation_quota from anon, authenticated;

create or replace function public.consume_web_generation_quota()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  requester uuid := (select auth.uid());
  reserved boolean;
begin
  if requester is null or not exists (
    select 1 from public.web_profiles where id = requester and role = 'teacher'
  ) then
    return false;
  end if;

  delete from public.web_generation_quota
  where owner_id = requester and window_start < now() - interval '2 days';

  insert into public.web_generation_quota (owner_id, window_start, attempt_count)
  values (requester, date_trunc('hour', now()), 1)
  on conflict (owner_id, window_start) do update
    set attempt_count = public.web_generation_quota.attempt_count + 1
    where public.web_generation_quota.attempt_count < 5
  returning true into reserved;
  return coalesce(reserved, false);
end;
$$;

revoke all on function public.consume_web_generation_quota() from public, anon;
grant execute on function public.consume_web_generation_quota() to authenticated;

drop function if exists public.release_web_generation_quota();

create or replace function public.release_web_generation_quota(p_owner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_window timestamptz := date_trunc('hour', now());
  reserved_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_owner_id is null or not exists (
    select 1 from public.web_profiles where id = p_owner_id and role = 'teacher'
  ) then
    raise exception 'teacher profile required' using errcode = '42501';
  end if;

  select attempt_count into reserved_count
  from public.web_generation_quota
  where owner_id = p_owner_id and window_start = current_window
  for update;

  if reserved_count = 1 then
    delete from public.web_generation_quota
    where owner_id = p_owner_id and window_start = current_window;
  elsif reserved_count > 1 then
    update public.web_generation_quota
    set attempt_count = attempt_count - 1
    where owner_id = p_owner_id and window_start = current_window;
  end if;
end;
$$;

revoke all on function public.release_web_generation_quota(uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_web_generation_quota(uuid) to service_role;
