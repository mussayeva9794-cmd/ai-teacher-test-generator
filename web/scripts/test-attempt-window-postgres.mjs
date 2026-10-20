import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rawDatabaseUrl = process.env.ATTEMPT_WINDOW_TEST_DATABASE_URL;
if (!rawDatabaseUrl) {
  throw new Error("Set ATTEMPT_WINDOW_TEST_DATABASE_URL to a disposable local PostgreSQL database.");
}

const databaseUrl = new URL(rawDatabaseUrl);
const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!allowedHosts.has(databaseUrl.hostname)) {
  throw new Error("Refusing to run the integration test against a non-local database host.");
}
if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== "ai_teacher_attempt_window_test") {
  throw new Error("The integration test only runs against ai_teacher_attempt_window_test.");
}
if (process.env.CI !== "true" && process.env.ATTEMPT_WINDOW_TEST_ALLOW_LOCAL !== "1") {
  throw new Error("Set ATTEMPT_WINDOW_TEST_ALLOW_LOCAL=1 to explicitly allow a local test run.");
}

const connection = [
  "-X", "-v", "ON_ERROR_STOP=1", "-qAt",
  "--host", databaseUrl.hostname.replace(/^\[|\]$/g, ""),
  "--port", databaseUrl.port || "5432",
  "--username", decodeURIComponent(databaseUrl.username || "postgres"),
  "--dbname", decodeURIComponent(databaseUrl.pathname.slice(1)),
];
const pgEnv = { ...process.env, PGPASSWORD: decodeURIComponent(databaseUrl.password) };
const migration = readFileSync(fileURLToPath(new URL("../supabase_attempt_window_atomic.sql", import.meta.url)), "utf8");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;

function psqlSync(sql) {
  const result = spawnSync("psql", connection, { env: pgEnv, input: sql, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr.trim()}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", connection, { env: pgEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`psql failed: ${stderr.trim()}`));
      resolve(stdout.trim().split(/\r?\n/).filter(Boolean));
    });
    child.stdin.end(sql);
  });
}

function finalizeSql({ linkId, testId, studentId, expectedAnswers, expectedUpdatedAt = "2026-10-20 10:00:00+00", currentAnswers, savedAnswers, currentScore = 20, savedScore = 80 }) {
  return `select public.finalize_web_attempt(
    ${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(studentId)}::uuid,
    ${quote(expectedUpdatedAt)}::timestamptz, ${json(expectedAnswers)},
    ${json(currentAnswers)}, ${currentScore}, ${json({ percentage: currentScore })},
    ${json(savedAnswers)}, ${savedScore}, ${json({ percentage: savedScore })}
  )::text;`;
}

function parseJsonRow(rows) {
  assert.equal(rows.length, 1, `expected one SQL result row, got ${rows.length}`);
  return JSON.parse(rows[0]);
}

const ids = Object.fromEntries(
  ["owner", "openTest", "openLink", "openStudent", "expiredSaveTest", "expiredSaveLink", "expiredSaveStudent",
    "expiredSubmitTest", "expiredSubmitLink", "expiredSubmitStudent", "raceTest", "raceLinkA", "raceLinkB", "raceStudent",
    "saveRaceTest", "saveRaceLink", "saveRaceStudent"]
    .map((name) => [name, randomUUID()]),
);

const schema = `
do $roles$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $roles$;
create table if not exists public.web_tests (
  id uuid primary key, owner_id uuid not null, status text not null
);
create table if not exists public.web_share_links (
  id uuid primary key, test_id uuid not null, owner_id uuid not null, variant_name text not null,
  settings jsonb not null default '{}'::jsonb, is_active boolean not null default true
);
create table if not exists public.web_attempts (
  id uuid primary key default gen_random_uuid(), test_id uuid not null, link_id uuid not null,
  student_id uuid not null, variant_name text not null, answers jsonb not null,
  percentage numeric not null, result jsonb not null, submitted_at timestamptz not null default now(),
  unique (test_id, student_id)
);
create table if not exists public.web_drafts (
  link_id uuid not null, student_id uuid not null, answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (link_id, student_id)
);
${migration}
`;
psqlSync(schema);

const insertCase = ({ testId, linkIds, studentId, settings = [{ timer_minutes: 0 }], answers = { q1: "saved" } }) => {
  const linkValues = linkIds.map((linkId, index) =>
    `(${quote(linkId)}::uuid, ${quote(testId)}::uuid, ${quote(ids.owner)}::uuid, 'A', ${json(settings[index] ?? settings[0])}, true)`,
  ).join(",\n");
  const draftValues = linkIds.map((linkId) =>
    `(${quote(linkId)}::uuid, ${quote(studentId)}::uuid, ${json(answers)}, now() - interval '1 minute', '2026-10-20 10:00:00+00')`,
  ).join(",\n");
  psqlSync(`
    insert into public.web_tests (id, owner_id, status) values (${quote(testId)}::uuid, ${quote(ids.owner)}::uuid, 'published');
    insert into public.web_share_links (id, test_id, owner_id, variant_name, settings, is_active) values ${linkValues};
    insert into public.web_drafts (link_id, student_id, answers, started_at, updated_at) values ${draftValues};
  `);
};

insertCase({ testId: ids.openTest, linkIds: [ids.openLink], studentId: ids.openStudent, settings: [{ timer_minutes: 10 }] });
insertCase({
  testId: ids.expiredSaveTest, linkIds: [ids.expiredSaveLink], studentId: ids.expiredSaveStudent,
  settings: [{ deadline_at: "2000-01-01T00:00:00Z", timer_minutes: 0 }],
});
insertCase({
  testId: ids.expiredSubmitTest, linkIds: [ids.expiredSubmitLink], studentId: ids.expiredSubmitStudent,
  settings: [{ deadline_at: "2000-01-01T00:00:00Z", timer_minutes: 0 }],
});
insertCase({ testId: ids.raceTest, linkIds: [ids.raceLinkA, ids.raceLinkB], studentId: ids.raceStudent });
insertCase({ testId: ids.saveRaceTest, linkIds: [ids.saveRaceLink], studentId: ids.saveRaceStudent, settings: [{ timer_minutes: 10 }] });

const openSaveStatus = psqlSync(`select public.save_web_draft_if_open(
  ${quote(ids.openLink)}::uuid, ${quote(ids.openTest)}::uuid, ${quote(ids.openStudent)}::uuid, ${json({ q1: "current" })}
);`)[0];
assert.equal(openSaveStatus, "saved", "draft should save before its timer expires");
const openDraft = parseJsonRow(psqlSync(`select jsonb_build_object('answers', answers, 'updated_at', updated_at)::text from public.web_drafts where link_id = ${quote(ids.openLink)}::uuid;`));
assert.deepEqual(openDraft.answers, { q1: "current" });

const expiredSaveStatus = psqlSync(`select public.save_web_draft_if_open(
  ${quote(ids.expiredSaveLink)}::uuid, ${quote(ids.expiredSaveTest)}::uuid, ${quote(ids.expiredSaveStudent)}::uuid, ${json({ q1: "late" })}
);`)[0];
assert.equal(expiredSaveStatus, "expired", "draft save must be rejected after the deadline");
assert.deepEqual(parseJsonRow(psqlSync(`select answers::text from public.web_drafts where link_id = ${quote(ids.expiredSaveLink)}::uuid;`)), { q1: "saved" });

const onTimeSubmit = parseJsonRow(psqlSync(finalizeSql({
  linkId: ids.openLink, testId: ids.openTest, studentId: ids.openStudent,
  expectedAnswers: openDraft.answers, expectedUpdatedAt: openDraft.updated_at,
  currentAnswers: { q1: "latest" }, savedAnswers: openDraft.answers,
})));
assert.equal(onTimeSubmit.status, "submitted");
assert.equal(onTimeSubmit.expired, false);
assert.deepEqual(parseJsonRow(psqlSync(`select jsonb_build_object('answers', answers, 'percentage', percentage)::text from public.web_attempts where test_id = ${quote(ids.openTest)}::uuid;`)), {
  answers: { q1: "latest" }, percentage: 20,
});

const expiredSubmit = parseJsonRow(psqlSync(finalizeSql({
  linkId: ids.expiredSubmitLink, testId: ids.expiredSubmitTest, studentId: ids.expiredSubmitStudent,
  expectedAnswers: { q1: "saved" }, currentAnswers: { q1: "too-late" }, savedAnswers: { q1: "saved" },
})));
assert.equal(expiredSubmit.status, "submitted");
assert.equal(expiredSubmit.expired, true);
assert.equal(expiredSubmit.percentage, 80);
assert.deepEqual(parseJsonRow(psqlSync(`select jsonb_build_object('answers', answers, 'percentage', percentage)::text from public.web_attempts where test_id = ${quote(ids.expiredSubmitTest)}::uuid;`)), {
  answers: { q1: "saved" }, percentage: 80,
});

const raceCalls = [ids.raceLinkA, ids.raceLinkB].map((linkId) =>
  psqlAsync(`select pg_sleep(0.2);\n${finalizeSql({
    linkId, testId: ids.raceTest, studentId: ids.raceStudent,
    expectedAnswers: { q1: "saved" }, currentAnswers: { q1: linkId }, savedAnswers: { q1: "saved" },
  })}`),
);
const raceResults = (await Promise.all(raceCalls)).map(parseJsonRow).map((result) => result.status).sort();
assert.deepEqual(raceResults, ["already_submitted", "submitted"], "concurrent links must allow exactly one attempt");
assert.equal(psqlSync(`select count(*) from public.web_attempts where test_id = ${quote(ids.raceTest)}::uuid and student_id = ${quote(ids.raceStudent)}::uuid;`)[0], "1");

const concurrentSaveAndSubmit = await Promise.all([
  psqlAsync(`select pg_sleep(0.2); select public.save_web_draft_if_open(
    ${quote(ids.saveRaceLink)}::uuid, ${quote(ids.saveRaceTest)}::uuid, ${quote(ids.saveRaceStudent)}::uuid, ${json({ q1: "autosaved" })}
  );`),
  psqlAsync(`select pg_sleep(0.2); ${finalizeSql({
    linkId: ids.saveRaceLink, testId: ids.saveRaceTest, studentId: ids.saveRaceStudent,
    expectedAnswers: { q1: "saved" }, currentAnswers: { q1: "submitted" }, savedAnswers: { q1: "saved" },
  })}`),
]);
const concurrentStatuses = concurrentSaveAndSubmit.map((rows) => {
  const result = rows.at(-1);
  return result.startsWith("{") ? JSON.parse(result).status : result;
}).sort();
assert.ok(
  (concurrentStatuses[0] === "draft_changed" && concurrentStatuses[1] === "saved") ||
    (concurrentStatuses[0] === "submitted" && concurrentStatuses[1] === "submitted"),
  `unexpected concurrent autosave/finalize outcomes: ${concurrentStatuses.join(", ")}`,
);
if (concurrentStatuses.includes("draft_changed")) {
  const latestDraft = parseJsonRow(psqlSync(`select jsonb_build_object('answers', answers, 'updated_at', updated_at)::text from public.web_drafts where link_id = ${quote(ids.saveRaceLink)}::uuid;`));
  const retry = psqlSync(`select public.finalize_web_attempt(
    ${quote(ids.saveRaceLink)}::uuid, ${quote(ids.saveRaceTest)}::uuid, ${quote(ids.saveRaceStudent)}::uuid,
    ${quote(latestDraft.updated_at)}::timestamptz, ${json(latestDraft.answers)}, ${json({ q1: "submitted" })},
    20, ${json({ percentage: 20 })}, ${json(latestDraft.answers)}, 80, ${json({ percentage: 80 })}
  )::text;`);
  assert.equal(parseJsonRow(retry).status, "submitted", "the route retry should finalize a fresh draft snapshot");
}

const grants = psqlSync(`select
  has_function_privilege('service_role', 'public.save_web_draft_if_open(uuid,uuid,uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.save_web_draft_if_open(uuid,uuid,uuid,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_web_attempt(uuid,uuid,uuid,timestamptz,jsonb,jsonb,numeric,jsonb,jsonb,numeric,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_web_attempt(uuid,uuid,uuid,timestamptz,jsonb,jsonb,numeric,jsonb,jsonb,numeric,jsonb)', 'execute');`)[0];
assert.equal(grants, "t", "only service_role should be allowed to execute the deadline RPCs");

console.log("PostgreSQL attempt-window integration passed: deadlines, saved-draft finalization, concurrent submissions, autosave race, and RPC grants.");
