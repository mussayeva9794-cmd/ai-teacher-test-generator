-- Run in Supabase SQL Editor before deploying the Vercel app.
-- This schema is separate from the legacy Streamlit tables; it does not delete them.
create table if not exists public.web_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('teacher', 'student')),
  created_at timestamptz not null default now()
);

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

drop trigger if exists on_web_auth_user_created on auth.users;
create trigger on_web_auth_user_created
after insert on auth.users for each row execute function public.create_web_profile();

create table if not exists public.web_tests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  topic text not null,
  language text not null default 'russian',
  grade_level text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  variants jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists web_tests_owner_created on public.web_tests(owner_id, created_at desc);

create table if not exists public.web_classes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 48),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);
create index if not exists web_classes_owner_created on public.web_classes(owner_id, created_at desc);

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

create table if not exists public.web_share_links (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.web_tests(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid references public.web_classes(id) on delete restrict,
  token uuid not null unique default gen_random_uuid(),
  variant_name text not null,
  variant_snapshot jsonb,
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.web_share_links
  add column if not exists variant_snapshot jsonb;
alter table public.web_share_links
  add column if not exists class_id uuid references public.web_classes(id) on delete restrict;
create index if not exists web_share_links_test on public.web_share_links(test_id);

create table if not exists public.web_attempts (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.web_tests(id) on delete cascade,
  link_id uuid not null references public.web_share_links(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  variant_name text not null,
  percentage numeric not null,
  answers jsonb not null,
  result jsonb not null,
  submitted_at timestamptz not null default now(),
  unique(test_id, student_id)
);
create index if not exists web_attempts_test on public.web_attempts(test_id, submitted_at desc);

create table if not exists public.web_drafts (
  link_id uuid not null references public.web_share_links(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(link_id, student_id)
);

alter table public.web_profiles enable row level security;
alter table public.web_tests enable row level security;
alter table public.web_share_links enable row level security;
alter table public.web_attempts enable row level security;
alter table public.web_drafts enable row level security;
alter table public.web_classes enable row level security;
alter table public.web_class_members enable row level security;

revoke all on public.web_profiles, public.web_tests, public.web_share_links,
  public.web_attempts, public.web_drafts from anon, authenticated;
revoke all on public.web_classes, public.web_class_members from anon, authenticated;
grant select on public.web_profiles to authenticated;
grant select, insert, update, delete on public.web_tests to authenticated;
grant select, insert, update, delete on public.web_share_links to authenticated;
grant select on public.web_attempts to authenticated;
grant select on public.web_drafts to authenticated;
grant select, insert, update, delete on public.web_classes, public.web_class_members to authenticated;

drop policy if exists web_profile_self on public.web_profiles;
create policy web_profile_self on public.web_profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists web_tests_teacher on public.web_tests;
create policy web_tests_teacher on public.web_tests for all to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.web_profiles p where p.id = (select auth.uid()) and p.role = 'teacher'
  ))
  with check (owner_id = (select auth.uid()) and exists (
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

drop policy if exists web_attempts_read on public.web_attempts;
create policy web_attempts_read on public.web_attempts for select to authenticated
  using (exists (
    select 1 from public.web_tests t where t.id = test_id and t.owner_id = (select auth.uid())
  ));

drop policy if exists web_drafts_self on public.web_drafts;
create policy web_drafts_self on public.web_drafts for select to authenticated
  using (student_id = (select auth.uid()));

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
