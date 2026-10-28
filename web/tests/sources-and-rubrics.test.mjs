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

test("deleting a question removes its rubric row and renumbers the later ones", () => {
  const page = read("../app/tests/[id]/page.tsx");
  assert.match(page, /v\.questions\.splice\(index, 1\);[^}]*row\.task !== index \+ 1[^}]*row\.task - 1/);
});

test("with a SOR/SOCh table the percentage follows its points, even after shuffling", async () => {
  const { grade, personalizedVariant } = await import("../lib/assessment.ts");
  const q = (id, answer) => ({ id, type: "multiple_choice", question: id, options: ["1", "2", "wrong"], correct_answer: answer, explanation: "", skill_tag: "" });
  const row = (task, points) => ({ task, criterion: "c", descriptor: "d", points });
  const base = { title: "T", instructions: "", questions: [q("a", "1"), q("b", "2")] };
  const weighted = { ...base, assessment: { kind: "sor", rows: [row(1, 1), row(2, 3)] } };
  const answers = { a: "wrong", b: "2" };
  assert.equal(grade(base, answers).percentage, 50, "no table: every question counts the same");
  const result = grade(weighted, answers);
  assert.equal(result.percentage, 75);
  assert.deepEqual(result.per_question.map((item) => item.points), [1, 3]);
  // Rows name tasks by position; the shuffled copy must keep each question's points.
  for (const student of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
    assert.equal(grade(personalizedVariant(weighted, "tok", student, true), answers).percentage, 75);
  }
  const stale = { ...weighted, assessment: { kind: "sor", rows: [row(1, 1)] } };
  assert.equal(grade(stale, answers).percentage, 50, "a stale table never decides a score");
});

test("AI score suggestions weigh questions by their table points", () => {
  const route = read("../app/api/tests/[id]/attempts/suggest/route.ts");
  assert.match(route, /typeof row\?\.points === "number" \? row\.points : 1/);
  assert.match(route, /total \/ possible/);
});

test("a test made from the teacher's material keeps it for replacements but never shows it to students", async () => {
  const { studentVariant } = await import("../lib/assessment.ts");
  const withText = { ...variant(), source_text: "Абай Кунанбаев родился в 1845 году." };
  assert.equal(isValidVariant(withText), true);
  assert.equal(isValidVariant({ ...variant(), source_text: "x".repeat(12001) }), false);
  assert.equal(isValidVariant({ ...variant(), source_text: 5 }), false);
  assert.equal("source_text" in studentVariant(withText), false);
  assert.match(read("../lib/groq.ts"), /source_text: input\.sourceText\.slice\(0, 12000\)/);
  assert.match(read("../app/api/tests/[id]/regenerate/route.ts"), /sourceText: typeof variant\.source_text === "string" \? variant\.source_text : ""/);
});
