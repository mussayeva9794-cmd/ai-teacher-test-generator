create table if not exists teacher_test_history (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    title text not null,
    topic text not null,
    language text not null,
    difficulty text not null,
    test_type text not null,
    grade_level text default '',
    assessment_purpose text default '',
    source_kind text not null,
    source_name text default '',
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
    student_name text not null,
    variant_name text not null,
    test_title text not null,
    percentage numeric not null default 0,
    owner_email text default '',
    payload jsonb not null
);
