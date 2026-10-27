import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidVariant, questionProblem } from "../lib/question-validation.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const question = { id: "q1", type: "short_answer", question: "Capital?", correct_answer: "Astana", explanation: "", skill_tag: "" };
const variant = (assessment) => ({ title: "T", instructions: "", questions: [question], ...(assessment ? { assessment } : {}) });

test("thinking levels are optional but must be known", () => {
  assert.equal(questionProblem({ ...question, bloom_level: "application" }), null);
  assert.equal(questionProblem({ ...question, bloom_level: "creative" }), "invalid");
});

test("a SOR/SOCh table must be well formed", () => {
  const row = { task: 1, criterion: "Определяет столицу", descriptor: "Обучающийся называет столицу", points: 1 };
  assert.equal(isValidVariant(variant({ kind: "sor", rows: [row] })), true);
  assert.equal(isValidVariant(variant()), true, "tests without a table stay valid");
  assert.equal(isValidVariant(variant({ kind: "exam", rows: [row] })), false);
  assert.equal(isValidVariant(variant({ kind: "soch", rows: [{ ...row, points: 11 }] })), false);
  assert.equal(isValidVariant(variant({ kind: "soch", rows: [{ ...row, task: 0 }] })), false);
  assert.equal(isValidVariant(variant({ kind: "soch", rows: [{ ...row, descriptor: "x".repeat(501) }] })), false);
});

test("a failed SOR/SOCh table never fails the generated test", () => {
  const route = read("../app/api/generate/route.ts");
  const rubric = route.indexOf("await generateRubrics(input, variants)");
  assert.ok(rubric > route.indexOf("variants = await generateVariants(input)"));
  assert.match(route.slice(rubric - 200, rubric + 400), /try \{[\s\S]*catch \(error\) \{\s*console\.error\("Rubric generation failed"/);
  assert.match(route, /body\.format === "sor" \|\| body\.format === "soch" \? body\.format : "test"/);
  assert.match(route, /Object\.hasOwn\(BLOOM_MIXES, body\.bloomMix\)/);
});

test("photo recognition is teacher-only, size-limited, quota-bound and refunds on failure", () => {
  const route = read("../app/api/sources/ocr/route.ts");
  assert.match(route, /actor\.role !== "teacher"/);
  assert.match(route, /const MAX_IMAGES = 3;/);
  assert.match(route, /data:image\\\/\(jpeg\|png\|webp\);base64,/);
  assert.match(route, /reduce\(\(sum, image\) => sum \+ image\.length, 0\) > MAX_TOTAL_CHARS/);
  assert.match(route, /reserveGenerationWindow\(db\)/);
  assert.equal((route.match(/releaseGenerationWindow\(adminClient, actor\.id, reservation\.window\)/g) || []).length, 2);
});
