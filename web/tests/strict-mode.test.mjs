import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leaveLimitReached, parseClientEvent, summarizeIntegrity } from "../lib/integrity.ts";
import { parseSettings } from "../lib/assessment.ts";
const { ru } = await import("../lib/i18n/dictionaries/ru.ts");

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const eventsRoute = read("../app/api/share/[token]/events/route.ts");
const draftRoute = read("../app/api/share/[token]/draft/route.ts");
const submitRoute = read("../app/api/share/[token]/submit/route.ts");
const shareRoute = read("../app/api/share/[token]/route.ts");
const attemptsRoute = read("../app/api/tests/[id]/attempts/route.ts");
const studentPage = read("../app/s/[token]/page.tsx");
const teacherPage = read("../app/tests/[id]/page.tsx");
const migration = read("../supabase_attempt_integrity.sql");
const strictMigration = read("../supabase_server_strict_progress.sql");

test("strict settings default safely and force one question at a time", () => {
  const legacy = parseSettings({ timer_minutes: 10 });
  assert.equal(legacy.strict_mode, false);
  assert.equal(legacy.question_seconds, 0);

  const strict = parseSettings({ strict_mode: true, leave_limit: 1, question_seconds: 90, one_question_at_a_time: false });
  assert.equal(strict.one_question_at_a_time, true);
  assert.equal(strict.leave_limit, 1);
  assert.equal(strict.question_seconds, 90);

  assert.equal(parseSettings({ strict_mode: true, leave_limit: null }).leave_limit, null);
  assert.equal(parseSettings({ strict_mode: true }).leave_limit, 2);
  assert.equal(parseSettings({ strict_mode: true, leave_limit: 99 }).leave_limit, 5);
  assert.equal(parseSettings({ strict_mode: true, leave_limit: "x" }).leave_limit, 2);
  assert.equal(parseSettings({ strict_mode: true, question_seconds: 3 }).question_seconds, 15);
  assert.equal(parseSettings({ strict_mode: true, question_seconds: 5000 }).question_seconds, 600);
  assert.equal(parseSettings({ strict_mode: "true" }).strict_mode, false);
});

test("the leave limit counts allowed leaves and only applies in strict mode", () => {
  assert.equal(leaveLimitReached({ strict_mode: true, leave_limit: 2 }, 2), false);
  assert.equal(leaveLimitReached({ strict_mode: true, leave_limit: 2 }, 3), true);
  assert.equal(leaveLimitReached({ strict_mode: true, leave_limit: 0 }, 1), true);
  assert.equal(leaveLimitReached({ strict_mode: true, leave_limit: null }, 50), false);
  assert.equal(leaveLimitReached({ strict_mode: false, leave_limit: 0 }, 50), false);
});

test("legacy event parsing is strict and the server rejects browser-owned question starts", () => {
  const ids = new Set(["q1", "q2"]);
  assert.deepEqual(parseClientEvent({ kind: "leave", question_id: "ignored" }, ids), { kind: "leave", question_id: null });
  assert.deepEqual(parseClientEvent({ kind: "question_shown", question_id: "q2" }, ids), { kind: "question_shown", question_id: "q2" });
  assert.equal(parseClientEvent({ kind: "question_shown", question_id: "q9" }, ids), null);
  assert.equal(parseClientEvent({ kind: "auto_submit" }, ids), null, "only the server records auto-submission");
  assert.equal(parseClientEvent({ kind: "delete_attempt" }, ids), null);
  assert.equal(parseClientEvent(["leave"], ids), null);
  assert.equal(parseClientEvent(null, ids), null);
  assert.match(eventsRoute, /event\.kind === "question_shown"/);
});

test("integrity summary counts signals and keeps the earliest start of each question", () => {
  const summary = summarizeIntegrity([
    { kind: "question_shown", question_id: "q1", created_at: "2026-10-24T10:00:05Z" },
    { kind: "question_shown", question_id: "q1", created_at: "2026-10-24T10:00:00Z" },
    { kind: "leave", question_id: null, created_at: "2026-10-24T10:00:10Z" },
    { kind: "return", question_id: null, created_at: "2026-10-24T10:00:20Z" },
    { kind: "leave", question_id: null, created_at: "2026-10-24T10:00:30Z" },
    { kind: "paste", question_id: null, created_at: "2026-10-24T10:00:40Z" },
    { kind: "copy", question_id: null, created_at: "2026-10-24T10:00:50Z" },
  ]);
  assert.equal(summary.events, 7);
  assert.equal(summary.leaves, 2);
  assert.equal(summary.pastes, 1);
  assert.equal(summary.copies, 1);
  assert.deepEqual(summary.question_started, { q1: "2026-10-24T10:00:00Z" });
});

test("the events API delegates atomic attempt and cap checks to the database", () => {
  assert.match(eventsRoute, /const context = await shareContext\(token, actor\)/);
  assert.match(eventsRoute, /if \(!settings\.strict_mode\) return jsonError/);
  assert.match(eventsRoute, /record_web_strict_event/);
  assert.match(eventsRoute, /event\.kind === "question_shown"/);
  assert.match(strictMigration, /perform pg_advisory_xact_lock/);
  assert.match(strictMigration, /if v_events >= 1000/);
  assert.match(strictMigration, /not exists \(select 1 from public\.web_drafts/);
});

test("strict answers and advancement are server-authoritative", () => {
  assert.match(draftRoute, /save_web_strict_answer_if_open/);
  assert.match(draftRoute, /question_id/);
  assert.match(submitRoute, /!settings\.strict_mode && isAnswersObject\(body\.answers\)/);
  assert.match(submitRoute, /p_current_answers: submittedAnswers/);
  assert.match(submitRoute, /kind: "auto_submit"/);
  assert.match(shareRoute, /start_or_load_web_strict_attempt/);
  assert.match(shareRoute, /Future questions never leave the server in strict mode/);
  assert.match(strictMigration, /save_web_strict_answer_if_open/);
  assert.match(strictMigration, /advance_web_strict_question/);
  assert.match(strictMigration, /v_ids ->> v_index is distinct from p_question_id/);
  // Answers after a question's own time are refused; moving on early is allowed.
  assert.match(strictMigration, /clock_timestamp\(\) >= v_question_started_at \+ make_interval\(secs => v_question_seconds\)[\s\S]*?'question_expired'/);
  assert.doesNotMatch(strictMigration, /'not_ready'/);
});

test("teacher results read signals through an ownership-checked, failure-tolerant summary", () => {
  assert.match(attemptsRoute, /eq\("owner_id", actor\.id\)[\s\S]*?web_attempt_integrity_summary/);
  assert.match(attemptsRoute, /if \(integrityError\) console\.error/);
  assert.match(teacherPage, /\{p\.strictNote\}/);
  assert.match(ru.testPage.strictNote, /Это сигналы для внимания, а не доказательство/);
  assert.match(teacherPage, /const headers = p\.csvHeaders;/);
  assert.deepEqual(ru.testPage.csvHeaders.slice(4), ["Уходов со страницы", "Вне теста (с)", "Вставок", "Копирований", "Автосдача"]);
});

test("the student page hides questions on leave, blocks clipboard, and receives only server-selected questions", () => {
  assert.match(studentPage, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(studentPage, /window\.addEventListener\("blur", leave\)/);
  assert.match(studentPage, /strict && away \?/);
  assert.match(studentPage, /onPaste=\{strict \? e => blockClipboard\(e, "paste"\)/);
  assert.match(studentPage, /className="strict-watermark" aria-hidden="true"/);
  assert.match(studentPage, /result\.strict_progress\?\.current_index/);
  assert.match(studentPage, /advanceStrictQuestion/);
  assert.match(studentPage, /api<StrictNextResponse>\(`\/api\/share\/\$\{token\}\/next`/);
  assert.match(studentPage, /advanceStrictQuestion\(true\)/, "a closed question advances using the last saved draft");
  assert.match(studentPage, /keepalive: true/);
});

test("the integrity table is service-role only and the migration is additive", () => {
  assert.match(migration, /create table if not exists public\.web_attempt_events/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.web_attempt_events from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.web_attempt_integrity_summary\(uuid\) from public, anon, authenticated/);
  const statements = migration.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(statements, /\bdrop\s+(table|function|policy|index)\b/i, "rollback lives in comments only");
  assert.doesNotMatch(statements, /alter table public\.web_(attempts|drafts|share_links|tests)\b/);
});

test("server strict migration stores ordered windows and reports their final durations", () => {
  assert.match(strictMigration, /create table if not exists public\.web_strict_attempt_state/);
  assert.match(strictMigration, /create table if not exists public\.web_strict_question_windows/);
  assert.match(strictMigration, /question_ids jsonb not null/);
  assert.match(strictMigration, /question_started_at timestamptz not null/);
  assert.match(strictMigration, /web_close_strict_question_window_after_submit/);
  assert.match(strictMigration, /revoke all on function public\.web_close_strict_question_window\(\)/);
  assert.match(strictMigration, /coalesce\(w\.ended_at, a\.submitted_at, w\.started_at\)/);
  assert.match(strictMigration, /legacy_question_totals/, "older strict attempts retain their event-derived timing data");
});

test("leave handling uses the same database lock as strict saves", () => {
  assert.match(eventsRoute, /record_web_strict_event/);
  assert.match(strictMigration, /record_web_strict_event/);
  assert.match(strictMigration, /perform pg_advisory_xact_lock/);
  assert.match(studentPage, /setLeaves\(current => current \+ 1\)/);
  const vercel = JSON.parse(read("../vercel.json"));
  assert.deepEqual(vercel.regions, ["sin1"], "Supabase runs in ap-southeast-1 (Singapore)");
});

test("the events API finalizes on the server when a leave crosses the limit", () => {
  assert.match(eventsRoute, /locked && event\.kind === "leave"\s*\? await finalizeLockedAttempt\(/);
  assert.match(studentPage, /if \(awayRef\.current \|\| timeoutSubmissionStarted\.current\) return;/);
  assert.match(studentPage, /strict_progress/);
});
