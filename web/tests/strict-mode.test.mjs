import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  enforceQuestionWindows, leaveLimitReached, parseClientEvent, questionWindowClosed, summarizeIntegrity, QUESTION_GRACE_MS,
} from "../lib/integrity.ts";
import { parseSettings } from "../lib/assessment.ts";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const eventsRoute = read("../app/api/share/[token]/events/route.ts");
const draftRoute = read("../app/api/share/[token]/draft/route.ts");
const submitRoute = read("../app/api/share/[token]/submit/route.ts");
const shareRoute = read("../app/api/share/[token]/route.ts");
const attemptsRoute = read("../app/api/tests/[id]/attempts/route.ts");
const studentPage = read("../app/s/[token]/page.tsx");
const teacherPage = read("../app/tests/[id]/page.tsx");
const migration = read("../supabase_attempt_integrity.sql");

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

test("client events are whitelisted and question starts must name a real question", () => {
  const ids = new Set(["q1", "q2"]);
  assert.deepEqual(parseClientEvent({ kind: "leave", question_id: "ignored" }, ids), { kind: "leave", question_id: null });
  assert.deepEqual(parseClientEvent({ kind: "question_shown", question_id: "q2" }, ids), { kind: "question_shown", question_id: "q2" });
  assert.equal(parseClientEvent({ kind: "question_shown", question_id: "q9" }, ids), null);
  assert.equal(parseClientEvent({ kind: "auto_submit" }, ids), null, "only the server records auto-submission");
  assert.equal(parseClientEvent({ kind: "delete_attempt" }, ids), null);
  assert.equal(parseClientEvent(["leave"], ids), null);
  assert.equal(parseClientEvent(null, ids), null);
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

test("closed or never-shown questions keep their saved answers", () => {
  const start = Date.parse("2026-10-24T10:00:00Z");
  const started = { q1: "2026-10-24T10:00:00Z", q2: "2026-10-24T10:01:00Z" };
  const now = start + 61_000 + QUESTION_GRACE_MS; // q1 closed (60 s), q2 open
  const result = enforceQuestionWindows(
    { q1: "changed", q2: "new", q3: "unseen" },
    { q1: "saved" },
    started, 60, now,
  );
  assert.deepEqual(result, { q1: "saved", q2: "new" });
  assert.deepEqual(enforceQuestionWindows({ q1: "x" }, {}, {}, 0, now), { q1: "x" }, "no per-question limit means no filtering");
  assert.equal(questionWindowClosed(started.q1, 60, start + 59_000), false);
  assert.equal(questionWindowClosed(started.q1, 60, start + 60_000), true);
  assert.equal(questionWindowClosed(undefined, 60, start + 999_999), false);
});

test("the events API requires a strict, unsubmitted attempt and caps stored events", () => {
  assert.match(eventsRoute, /const context = await shareContext\(token, actor\)/);
  assert.match(eventsRoute, /if \(!settings\.strict_mode\) return jsonError/);
  assert.match(eventsRoute, /from\("web_attempts"\)[\s\S]*?if \(prior\) return jsonError\("This test was already submitted\.", 409\)/);
  assert.match(eventsRoute, /before\.events >= MAX_EVENTS_PER_ATTEMPT/);
  assert.match(eventsRoute, /duplicateStart/);
});

test("save and submit enforce the leave lock and per-question windows on the server", () => {
  assert.match(draftRoute, /leaveLimitReached\(settings, integrity\.leaves\)[\s\S]*?423/);
  assert.match(draftRoute, /enforceQuestionWindows\(answers, previous, integrity\.question_started/);
  assert.match(draftRoute, /const unstarted = Object\.keys\(answers\)[\s\S]*?kind: "question_shown"[\s\S]*?integrity\.question_started\[id\] = startedAt/,
    "a lost start event starts the window on first answer instead of dropping it");
  assert.match(submitRoute, /isAnswersObject\(body\.answers\) && !strictLocked/);
  assert.match(submitRoute, /enforceQuestionWindows\(currentAnswers, savedAnswers, integrity\.question_started/);
  assert.match(submitRoute, /p_current_answers: submittedAnswers/);
  assert.match(submitRoute, /kind: "auto_submit"/);
  assert.match(shareRoute, /student_label:/);
  assert.match(shareRoute, /settings\.strict_mode \? await loadIntegrity/);
});

test("teacher results read signals through an ownership-checked, failure-tolerant summary", () => {
  assert.match(attemptsRoute, /eq\("owner_id", actor\.id\)[\s\S]*?web_attempt_integrity_summary/);
  assert.match(attemptsRoute, /if \(integrityError\) console\.error/);
  assert.match(teacherPage, /Это сигналы для внимания, а не доказательство/);
  assert.match(teacherPage, /"Уходов со страницы", "Вне теста \(с\)", "Вставок", "Копирований", "Автосдача"/);
});

test("the student page hides questions on leave, blocks clipboard, watermarks, and resumes timers", () => {
  assert.match(studentPage, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(studentPage, /window\.addEventListener\("blur", leave\)/);
  assert.match(studentPage, /strict && away \?/);
  assert.match(studentPage, /onPaste=\{strict \? e => blockClipboard\(e, "paste"\)/);
  assert.match(studentPage, /className="strict-watermark" aria-hidden="true"/);
  assert.match(studentPage, /questionWindowClosed\(result\.integrity!\.question_started\[q\.id\]/);
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
