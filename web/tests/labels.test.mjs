import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { distinctTopic, languageLabel, testMeta, variantLabel } from "../lib/labels.ts";

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
