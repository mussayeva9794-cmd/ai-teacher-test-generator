-- Add Google-friendly student rosters and class-scoped share links.
-- Apply after supabase_v2.sql and before deploying the matching application code.
-- Existing links keep class_id NULL and retain their current email/public behavior.

create table if not exists public.web_classes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 48),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);
create index if not exists web_classes_owner_created
  on public.web_classes(owner_id, created_at desc);

create table if not exists public.web_class_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.web_classes(id) on delete cascade,
  email text not null check (
    email = lower(trim(email)) and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  student_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, email)
);
create unique index if not exists web_class_members_student_unique
  on public.web_class_members(class_id, student_id) where student_id is not null;
create index if not exists web_class_members_email on public.web_class_members(email);

alter table public.web_share_links
  add column if not exists class_id uuid references public.web_classes(id) on delete restrict;

alter table public.web_classes enable row level security;
alter table public.web_class_members enable row level security;

revoke all on public.web_classes, public.web_class_members from anon, authenticated;
grant select, insert, update, delete on public.web_classes, public.web_class_members to authenticated;

drop policy if exists web_classes_teacher on public.web_classes;
create policy web_classes_teacher on public.web_classes for all to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.web_profiles p where p.id = (select auth.uid()) and p.role = 'teacher'
  ))
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.web_profiles p where p.id = (select auth.uid()) and p.role = 'teacher'
  ));

drop policy if exists web_class_members_teacher on public.web_class_members;
create policy web_class_members_teacher on public.web_class_members for all to authenticated
  using (exists (
    select 1 from public.web_classes c where c.id = class_id and c.owner_id = (select auth.uid())
  ) and exists (
    select 1 from public.web_profiles p where p.id = (select auth.uid()) and p.role = 'teacher'
  ))
  with check (exists (
    select 1 from public.web_classes c where c.id = class_id and c.owner_id = (select auth.uid())
  ) and exists (
    select 1 from public.web_profiles p where p.id = (select auth.uid()) and p.role = 'teacher'
  ));

drop policy if exists web_links_teacher on public.web_share_links;
create policy web_links_teacher on public.web_share_links for all to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.web_tests t where t.id = test_id and t.owner_id = (select auth.uid())
  ))
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.web_tests t where t.id = test_id and t.owner_id = (select auth.uid())
  ) and (class_id is null or exists (
    select 1 from public.web_classes c where c.id = class_id and c.owner_id = (select auth.uid())
  )));

create or replace function public.create_web_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.web_profiles (id, display_name, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      split_part(new.email, '@', 1)
    ),
    'student'
  ) on conflict (id) do nothing;
  return new;
end;
$$;
