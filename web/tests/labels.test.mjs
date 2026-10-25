import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";

// lib/ uses extensionless relative imports (resolved by Next); add ".ts" here.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.includes("/lib/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { distinctTopic, languageLabel, testMeta, variantLabel } = await import("../lib/labels.ts");

const teacherPage = readFileSync(fileURLToPath(new URL("../app/tests/[id]/page.tsx", import.meta.url)), "utf8");

test("stored English values are shown in Russian", () => {
  assert.equal(variantLabel("Variant A"), "Вариант A");
  assert.equal(variantLabel("Вариант B"), "Вариант B");
  assert.equal(languageLabel("russian"), "Русский");
  assert.equal(languageLabel("kazakh"), "Қазақша");
  assert.equal(languageLabel("english"), "English");
  assert.equal(languageLabel("unknown"), "unknown");
});

test("a topic that repeats the title is not shown twice", () => {
  assert.equal(distinctTopic("Python", "Тест по теме «Python»"), "");
  assert.equal(distinctTopic("Пробный тест: строгий режим", "Пробный тест: строгий режим"), "");
  assert.equal(distinctTopic("Радиоактивный распад", "Radioactive Decay Assessment"), "Радиоактивный распад");
  assert.equal(testMeta({ topic: "Python", title: "Тест по теме «Python»", grade_level: "", language: "russian" }), "Русский");
  assert.equal(testMeta({ topic: "Дроби", title: "Контрольная", grade_level: "5 класс", language: "kazakh" }), "Дроби · 5 класс · Қазақша");
});

test("unsaved question edits are protected", () => {
  // Creating a link or saving a review reloads the test; that must not wipe edits.
  assert.match(teacherPage, /if \(!dirtyRef\.current\) \{ setTest\(testResult\.test\); savedSnapshot\.current = snapshot\(testResult\.test\); \}/);
  assert.match(teacherPage, /addEventListener\("beforeunload", warn\)/);
  assert.match(teacherPage, /<TeacherHeader current="tests" canLeave=\{canLeave\} \/>/);
  assert.match(teacherPage, /savedSnapshot\.current = snapshot\(test\);\s*setTest\(\{ \.\.\.test, status/);
  assert.doesNotMatch(teacherPage, /Vercel/);
});

test("the overall timer counts on the server clock, not the device clock", () => {
  const studentPage = readFileSync(fileURLToPath(new URL("../app/s/[token]/page.tsx", import.meta.url)), "utf8");
  const shareRoute = readFileSync(fileURLToPath(new URL("../app/api/share/[token]/route.ts", import.meta.url)), "utf8");
  assert.match(studentPage, /Date\.parse\(test\.closes_at!\) - \(Date\.now\(\) \+ clockOffset\.current\)/);
  assert.match(studentPage, /if \(result\.server_now\) clockOffset\.current = [^\n]+\n\s+if \(result\.settings\.strict_mode && result\.integrity\)/);
  assert.match(shareRoute, /\} : \{\}\),\n\s+server_now: new Date\(\)\.toISOString\(\),\n\s+\}\);/);
});

test("server Supabase calls time out and the actor check keeps getUser authoritative", () => {
  const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const auth = read("../lib/auth.ts");
  assert.match(auth, /userData\.user\.id !== subject\) return null/);
  assert.match(read("../lib/supabase-admin.ts"), /global: \{ fetch: timedFetch \}/);
  assert.equal((read("../lib/supabase.ts").match(/global: \{ fetch: timedFetch \}/g) || []).length, 2);
  assert.match(read("../lib/server-fetch.ts"), /AbortSignal\.timeout\(SERVER_FETCH_TIMEOUT_MS\)/);
});
