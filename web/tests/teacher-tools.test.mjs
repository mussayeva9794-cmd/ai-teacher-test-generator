import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { questionProblem, isValidVariant } from "../lib/question-validation.ts";
import { parseSettings } from "../lib/assessment.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const shareRoute = read("../app/api/share/[token]/route.ts");
const regenerateRoute = read("../app/api/tests/[id]/regenerate/route.ts");

const mc = { id: "q1", type: "multiple_choice", question: "2 + 2?", options: ["3", "4"], correct_answer: "4", explanation: "", skill_tag: "" };

test("question problems name what the teacher has to fix", () => {
  assert.equal(questionProblem(mc), null);
  assert.equal(questionProblem({ ...mc, question: " " }), "empty_question");
  assert.equal(questionProblem({ ...mc, options: ["4"] }), "options_count");
  assert.equal(questionProblem({ ...mc, options: ["4", ""] }), "options_empty");
  assert.equal(questionProblem({ ...mc, options: ["4", " 4 "] }), "options_duplicate");
  assert.equal(questionProblem({ ...mc, correct_answer: "" }), "correct_missing");
  assert.equal(questionProblem({ ...mc, type: "short_answer", options: undefined, correct_answer: "" }), "answer_empty");
  const pairs = [{ left: "a", right: "1" }, { left: "b", right: "2" }];
  assert.equal(questionProblem({ ...mc, type: "matching", options: undefined, correct_answer: "", pairs }), null);
  assert.equal(questionProblem({ ...mc, type: "matching", options: undefined, correct_answer: "", pairs: [pairs[0]] }), "pairs_count");
  assert.equal(questionProblem({ ...mc, type: "matching", options: undefined, correct_answer: "", pairs: [pairs[0], { left: "A", right: "3" }] }), "pairs_duplicate");
  assert.equal(questionProblem({ ...mc, type: "essay" }), "invalid");
});

test("a variant with two questions sharing an id is rejected", () => {
  assert.equal(isValidVariant({ title: "T", instructions: "", questions: [mc, { ...mc, question: "Other" }] }), false);
  assert.equal(isValidVariant({ title: "T", instructions: "", questions: [mc, { ...mc, id: "q2" }] }), true);
});

test("full screen is required only for strict links that ask for it", () => {
  assert.equal(parseSettings({ strict_mode: true, require_fullscreen: true }).require_fullscreen, true);
  assert.equal(parseSettings({ strict_mode: true }).require_fullscreen, false);
  assert.equal(parseSettings({ strict_mode: false, require_fullscreen: true }).require_fullscreen, false);
});

test("a full-screen attempt is not started before the student enters full screen", () => {
  const wait = shareRoute.indexOf('get("start") === "after_fullscreen"');
  const start = shareRoute.indexOf('admin.rpc("start_web_draft_if_open"');
  assert.ok(wait > 0 && start > wait, "the wait answer comes before the draft is started");
  assert.match(shareRoute, /if \(!draft && settings\.strict_mode && settings\.require_fullscreen &&/);
});

test("replacing a question checks ownership, the request shape and own variant names", () => {
  assert.match(regenerateRoute, /actor\.role !== "teacher"/);
  assert.match(regenerateRoute, /\.eq\("id", id\)\.eq\("owner_id", actor\.id\)/);
  assert.match(regenerateRoute, /!body \|\| typeof body !== "object" \|\| Array\.isArray\(body\)/);
  assert.match(regenerateRoute, /Object\.hasOwn\(test\.variants, body\.variant_name\)/);
  assert.match(regenerateRoute, /reserveGenerationWindow\(db\)/);
  assert.match(regenerateRoute, /releaseGenerationWindow\(adminClient, actor\.id, reservation\.window\)/);
});
