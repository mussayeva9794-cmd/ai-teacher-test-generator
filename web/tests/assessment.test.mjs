import test from "node:test";
import assert from "node:assert/strict";
import { grade, personalizedVariant, studentVariant, parseSettings } from "../lib/assessment.ts";

const variant = {
  title: "Demo", instructions: "Answer all questions", questions: [
    { id: "q1", type: "multiple_choice", question: "2 + 2?", options: ["3", "4", "5"], correct_answer: "4", explanation: "Addition", skill_tag: "Arithmetic" },
    { id: "q2", type: "short_answer", question: "Capital of Kazakhstan?", correct_answer: "Astana", explanation: "Capital", skill_tag: "Geography" },
  ],
};

test("student payload never contains answer keys or explanations", () => {
  const publicVariant = studentVariant(variant);
  assert.equal(JSON.stringify(publicVariant).includes("correct_answer"), false);
  assert.equal(JSON.stringify(publicVariant).includes("explanation"), false);
});

test("grading accepts correct answers and rejects wrong ones", () => {
  assert.equal(grade(variant, { q1: "4", q2: "Astana" }).percentage, 100);
  assert.equal(grade(variant, { q1: "3", q2: "wrong" }).percentage, 0);
});

test("personalization is stable for the same student", () => {
  const first = personalizedVariant(variant, "link", "student-1", true);
  const second = personalizedVariant(variant, "link", "student-1", true);
  assert.deepEqual(first, second);
});

test("share settings default to no instant score and clamp timer", () => {
  const settings = parseSettings({ timer_minutes: 999, allowed_students: [" Student@Example.com "] });
  assert.equal(settings.reveal_score, false);
  assert.equal(settings.timer_minutes, 240);
  assert.deepEqual(settings.allowed_students, ["student@example.com"]);
});
