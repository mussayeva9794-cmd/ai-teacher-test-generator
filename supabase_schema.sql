create table if not exists app_users (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    email text not null unique,
    display_name text not null,
    password_hash text not null,
    role text not null,
    auth_provider text default 'local',
    auth_user_id text default '',
    plan_name text default 'free',
    account_status text default 'active',
    trial_ends_at text default ''
);

create table if not exists teacher_test_history (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    test_uid text default '',
    title text not null,
    topic text not null,
    language text not null,
    difficulty text not null,
    test_type text not null,
    grade_level text default '',
    assessment_purpose text default '',
    owner_email text default '',
    source_kind text not null,
    source_name text default '',
    subject_tags text default '',
    is_favorite boolean not null default false,
    archived boolean not null default false,
    is_autosave boolean not null default false,
    payload jsonb not null
);

create table if not exists teacher_question_bank (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    question_text text not null,
    question_type text not null,
    topic text default '',
    skill_tag text default '',
    owner_email text default '',
    payload jsonb not null
);

create table if not exists teacher_attempts (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    student_name text not null,
    student_key text default '',
    test_uid text default '',
    variant_name text not null,
    test_title text not null,
    owner_email text default '',
    share_token text default '',
    submission_key text default '',
    review_status text default 'submitted',
    teacher_note text default '',
    answer_signature text default '',
    percentage numeric not null default 0,
    payload jsonb not null
);

create table if not exists teacher_share_links (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    token text not null unique,
    test_uid text default '',
    title text not null,
    variant_name text not null,
    owner_email text default '',
    is_active boolean not null default true,
    max_attempts integer not null default 1,
    deadline_at text default '',
    payload jsonb not null
);

create table if not exists teacher_student_drafts (
    id bigint generated always as identity primary key,
    updated_at timestamptz not null default now(),
    share_token text not null,
    student_name text not null,
    payload jsonb not null
);

create unique index if not exists teacher_student_drafts_unique
    on teacher_student_drafts (share_token, student_name);

create table if not exists teacher_api_error_logs (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    provider text not null,
    error_message text not null,
    context_json jsonb default '{}'::jsonb
);

create table if not exists teacher_audit_logs (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    actor_email text not null,
    actor_role text default '',
    event_type text not null,
    target_type text default '',
    target_id text default '',
    details_json jsonb default '{}'::jsonb
);

create table if not exists teacher_usage_events (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    owner_email text not null,
    event_type text not null,
    quantity integer not null default 1,
    context_json jsonb default '{}'::jsonb
);

create table if not exists schema_meta (
    key text primary key,
    value text not null
);

insert into schema_meta (key, value)
values ('schema_version', '5')
on conflict (key) do update set value = '5';

create table if not exists teacher_groups (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    owner_email text not null,
    name text not null,
    grade_level text default '',
    description text default ''
);

create table if not exists teacher_group_students (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    owner_email text not null,
    group_id bigint references teacher_groups(id) on delete cascade,
    full_name text not null,
    email text default '',
    external_id text default '',
    notes text default ''
);

create unique index if not exists teacher_group_students_unique
    on teacher_group_students (group_id, email, full_name);

-- Optional production hardening:
-- 1. Move user sessions to Supabase Auth.
-- 2. Add auth_user_id in app_users and map it to auth.users.id.
-- 3. Enable RLS on teacher_* tables and restrict rows by owner_email/student_key.
-- Example starter policy pattern:
-- alter table teacher_test_history enable row level security;
-- create policy teacher_owns_tests on teacher_test_history
-- for all using (owner_email = auth.jwt() ->> 'email');
