import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This test intentionally refuses remote targets: it recreates only a named,
// disposable local database and proves the strict-mode RPC contract itself.
const rawDatabaseUrl = process.env.STRICT_PROGRESS_TEST_DATABASE_URL;
if (!rawDatabaseUrl) throw new Error("Set STRICT_PROGRESS_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
const databaseUrl = new URL(rawDatabaseUrl);
if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(databaseUrl.hostname)) {
  throw new Error("Refusing to run the strict-progress test against a non-local database host.");
}
if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== "ai_teacher_strict_progress_test") {
  throw new Error("The strict-progress test only runs against ai_teacher_strict_progress_test.");
}
if (process.env.STRICT_PROGRESS_TEST_ALLOW_LOCAL !== "1") {
  throw new Error("Set STRICT_PROGRESS_TEST_ALLOW_LOCAL=1 to explicitly allow a local test run.");
}

const connection = [
  "-X", "-v", "ON_ERROR_STOP=1", "-qAt",
  "--host", databaseUrl.hostname.replace(/^\[|\]$/g, ""),
  "--port", databaseUrl.port || "5432",
  "--username", decodeURIComponent(databaseUrl.username || "postgres"),
  "--dbname", decodeURIComponent(databaseUrl.pathname.slice(1)),
];
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(databaseUrl.password) };
const strictMigration = readFileSync(fileURLToPath(new URL("../supabase_server_strict_progress.sql", import.meta.url)), "utf8");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const uuid = () => randomUUID();
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;

function psql(sql) {
  const result = spawnSync("psql", connection, { env: pgEnv, input: sql, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr.trim()}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function jsonRow(sql) {
  const rows = psql(sql);
  assert.equal(rows.length, 1, `expected one SQL result row, got ${rows.length}`);
  return JSON.parse(rows[0]);
}

const owner = uuid();
const student = uuid();
const testId = uuid();
const linkId = uuid();
const questionIds = ["question-one", "question-two"];

psql(`
  drop schema public cascade;
  create schema public;
  create extension if not exists pgcrypto;
  drop schema if exists auth cascade;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values (${quote(student)}::uuid);
  do $roles$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $roles$;
  create table public.web_tests (id uuid primary key, owner_id uuid not null, status text not null);
  create table public.web_share_links (
    id uuid primary key, test_id uuid not null, owner_id uuid not null,
    settings jsonb not null default '{}'::jsonb, is_active boolean not null default true
  );
  create table public.web_drafts (
    link_id uuid not null, student_id uuid not null, answers jsonb not null default '{}'::jsonb,
    started_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
    primary key (link_id, student_id)
  );
  create table public.web_attempts (
    id uuid primary key default gen_random_uuid(), test_id uuid not null, link_id uuid not null,
    student_id uuid not null, submitted_at timestamptz not null default clock_timestamp(),
    unique (test_id, student_id)
  );
  create table public.web_attempt_events (
    id bigint generated always as identity primary key, link_id uuid not null, test_id uuid not null,
    student_id uuid not null, kind text not null, question_id text, created_at timestamptz not null default clock_timestamp()
  );
  ${strictMigration}
  insert into public.web_tests values (${quote(testId)}::uuid, ${quote(owner)}::uuid, 'published');
  insert into public.web_share_links values (
    ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(owner)}::uuid,
    ${json({ strict_mode: true, timer_minutes: 0, question_seconds: 0, leave_limit: 1 })}, true
  );
  insert into public.web_drafts (link_id, student_id) values (${quote(linkId)}::uuid, ${quote(student)}::uuid);
`);

const start = jsonRow(`select public.start_or_load_web_strict_attempt(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid, ${json(questionIds)}
)::text;`);
assert.equal(start.status, "ready");
assert.equal(start.current_index, 0);

const firstSave = jsonRow(`select public.save_web_strict_answer_if_open(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid, 'question-one', ${json("first answer")}
)::text;`);
assert.equal(firstSave.status, "saved");
const futureSave = jsonRow(`select public.save_web_strict_answer_if_open(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid, 'question-two', ${json("must fail")}
)::text;`);
assert.equal(futureSave.status, "wrong_question", "the next answer must not be saved before server advance");

const advance = jsonRow(`select public.advance_web_strict_question(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid
)::text;`);
assert.equal(advance.status, "advanced");
assert.equal(advance.current_index, 1);
const secondSave = jsonRow(`select public.save_web_strict_answer_if_open(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid, 'question-two', ${json("second answer")}
)::text;`);
assert.equal(secondSave.status, "saved");

const firstLeave = jsonRow(`select public.record_web_strict_event(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid, 'leave'
)::text;`);
assert.deepEqual({ leaves: firstLeave.leaves, locked: firstLeave.locked }, { leaves: 1, locked: false });
const secondLeave = jsonRow(`select public.record_web_strict_event(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid, 'leave'
)::text;`);
assert.deepEqual({ leaves: secondLeave.leaves, locked: secondLeave.locked }, { leaves: 2, locked: true });

const finish = jsonRow(`select public.advance_web_strict_question(
  ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(student)}::uuid
)::text;`);
assert.equal(finish.status, "finished");
assert.deepEqual(jsonRow(`select answers::text from public.web_drafts where link_id = ${quote(linkId)}::uuid;`), {
  "question-one": "first answer", "question-two": "second answer",
});

psql(`insert into public.web_attempts (test_id, link_id, student_id) values (
  ${quote(testId)}::uuid, ${quote(linkId)}::uuid, ${quote(student)}::uuid
);`);
const windows = jsonRow(`select jsonb_object_agg(question_index, ended_at is not null)::text
  from public.web_strict_question_windows where link_id = ${quote(linkId)}::uuid;`);
assert.deepEqual(windows, { "0": true, "1": true }, "submission closes every remaining strict window");

// Per-question timer: a student who has answered may move on early (no going
// back), and an answer to a question whose own time has run out is refused.
// Found in review: refusing an early advance left the "Далее" button inert and
// could strand a student whose phone clock ran slightly ahead of the server.
const timedTest = uuid();
const timedLink = uuid();
psql(`
  insert into public.web_tests values (${quote(timedTest)}::uuid, ${quote(owner)}::uuid, 'published');
  insert into public.web_share_links values (
    ${quote(timedLink)}::uuid, ${quote(timedTest)}::uuid, ${quote(owner)}::uuid,
    ${json({ strict_mode: true, timer_minutes: 0, question_seconds: 60, leave_limit: null })}, true
  );
  insert into public.web_drafts (link_id, student_id) values (${quote(timedLink)}::uuid, ${quote(student)}::uuid);
`);
const callTimed = (fn, extra = "") => jsonRow(`select public.${fn}(
  ${quote(timedLink)}::uuid, ${quote(timedTest)}::uuid, ${quote(student)}::uuid${extra}
)::text;`);
assert.equal(callTimed("start_or_load_web_strict_attempt", `, ${json(questionIds)}`).status, "ready");
assert.equal(callTimed("save_web_strict_answer_if_open", `, 'question-one', ${json("quick answer")}`).status, "saved");
const early = callTimed("advance_web_strict_question");
assert.equal(early.status, "advanced", "moving on before the question timer ends must be allowed");
assert.equal(early.current_index, 1);
assert.equal(callTimed("save_web_strict_answer_if_open", `, 'question-one', ${json("changed later")}`).status, "wrong_question",
  "an earlier question stays closed after moving on");
psql(`update public.web_strict_attempt_state set question_started_at = clock_timestamp() - interval '61 seconds'
  where link_id = ${quote(timedLink)}::uuid;`);
assert.equal(callTimed("save_web_strict_answer_if_open", `, 'question-two', ${json("too late")}`).status, "question_expired");
assert.equal(callTimed("advance_web_strict_question").status, "finished");
assert.deepEqual(jsonRow(`select answers::text from public.web_drafts where link_id = ${quote(timedLink)}::uuid;`), {
  "question-one": "quick answer",
});

assert.equal(psql("select has_function_privilege('anon', 'public.save_web_strict_answer_if_open(uuid,uuid,uuid,text,jsonb)', 'execute');")[0], "f");
assert.equal(psql("select has_function_privilege('authenticated', 'public.advance_web_strict_question(uuid,uuid,uuid)', 'execute');")[0], "f");
assert.equal(psql("select has_table_privilege('authenticated', 'public.web_strict_attempt_state', 'select');")[0], "f");

console.log("Strict progress PostgreSQL integration test passed.");
