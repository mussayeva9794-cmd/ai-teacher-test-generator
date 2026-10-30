import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => globalThis.writtenMocks.actor; export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/supabase", "export const userClient = () => globalThis.writtenMocks.userDb;"],
  ["@/lib/supabase-admin", "export const adminClient = () => globalThis.writtenMocks.adminDb;"],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    // lib/ and app/ use extensionless imports and the "@/" alias, resolved by Next.
    if (specifier.startsWith("@/lib/")) return nextResolve(new URL(`../lib/${specifier.slice(6)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});

const { grade, studentVariant, answerReview } = await import("../lib/assessment.ts");
const { isValidVariant, questionProblem } = await import("../lib/question-validation.ts");
const { writtenVariant } = await import("../lib/written-work.ts");
const { DEFAULT_NORMS } = await import("../lib/dictation.ts");
const { PATCH: markDictation } = await import("../app/api/tests/[id]/attempts/dictation/route.ts");
const { POST: createWork } = await import("../app/api/tests/route.ts");
const { PATCH: patchTest } = await import("../app/api/tests/[id]/route.ts");

const reference = "Я знаю, что он придёт, и мы пойдём в лес.";
const dictation = writtenVariant("dictation", "russian", "Диктант", reference);
const essay = writtenVariant("essay", "russian", "Эссе", "Почему важно читать?");

test("every kind of written work makes a valid one-question variant", () => {
  for (const kind of ["dictation", "words", "copy", "essay"]) {
    for (const language of ["russian", "kazakh", "english"]) {
      const variant = writtenVariant(kind, language, "T", "Текст работы.");
      assert.equal(isValidVariant(variant), true, `${kind}/${language}`);
      assert.equal(variant.questions.length, 1);
    }
  }
  const question = dictation.questions[0];
  assert.equal(questionProblem({ ...question, correct_answer: " . , " }), "reference_empty");
  assert.equal(questionProblem({ ...question, correct_answer: "а".repeat(6001) }), "reference_long");
  assert.equal(questionProblem({ ...question, dictation_mode: "poem" }), "invalid");
  assert.equal(questionProblem({ ...question, grade_norms: { ...DEFAULT_NORMS.dictation, five: { spelling: 9, punctuation: 0, total: 0 } } }), "norms_invalid");
  assert.equal(questionProblem({ ...question, grade_norms: undefined }), null, "a dictation without its own norms uses the school ones");
  const work = essay.questions[0];
  assert.equal(questionProblem({ ...work, criteria: [] }), "criteria_invalid");
  assert.equal(questionProblem({ ...work, criteria: [{ name: "Содержание", points: 21 }] }), "criteria_invalid");
  assert.equal(questionProblem({ ...work, min_words: -1 }), "invalid");
});

test("a submitted dictation is graded 2–5 and keeps what it was checked against", () => {
  const result = grade(dictation, { "written-dictation": "Я знаю что он придёт и мы пойдём в лес." });
  const row = result.per_question[0];
  assert.equal(row.dictation.grade, 4);
  assert.deepEqual([row.dictation.spelling, row.dictation.punctuation], [0, 2]);
  assert.equal(row.dictation.reference, reference);
  assert.deepEqual(row.dictation.norms, DEFAULT_NORMS.dictation);
  assert.equal(row.score, 0.75);
  assert.equal(result.percentage, 75);
  assert.equal(result.requires_manual_review, false);
  assert.equal(grade(dictation, {}).percentage, 0, "a blank dictation scores nothing");
});

test("an essay waits for the teacher unless it is empty", () => {
  const written = grade(essay, { "written-essay": "Книги учат думать." });
  assert.equal(written.requires_manual_review, true);
  assert.equal(written.percentage, null);
  const empty = grade(essay, { "written-essay": "   " });
  assert.equal(empty.requires_manual_review, false);
  assert.equal(empty.percentage, 0);
});

test("students see the text only when copying, and never the norms' answer key", () => {
  const sent = studentVariant(dictation).questions[0];
  assert.equal(sent.correct_answer, undefined);
  assert.equal(sent.copy_text, undefined);
  assert.equal(JSON.stringify(sent).includes("придёт"), false, "the dictation text never reaches the student");
  const copy = studentVariant(writtenVariant("copy", "russian", "Списывание", reference)).questions[0];
  assert.equal(copy.copy_text, reference);
});

test("the after-submission review carries the stored dictation", () => {
  const answers = { "written-dictation": "Я знаю что он придёт и мы пойдём в лес." };
  const [item] = answerReview(dictation, answers, grade(dictation, answers));
  assert.equal(item.dictation.grade, 4);
  assert.equal(item.given, answers["written-dictation"]);
});

function setupMarks({ result, answers }) {
  const updates = [];
  globalThis.writtenMocks = {
    actor: { id: "teacher-1", role: "teacher", accessToken: "token" },
    userDb: { from: () => ({ select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: { id: "test-1" }, error: null }) }) }) },
    adminDb: { from: () => ({
      select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: { id: "attempt-1", answers, result }, error: null }) }),
      update: (payload) => { updates.push(payload); return { eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
    }) },
  };
  return updates;
}

const context = { params: Promise.resolve({ id: "test-1" }) };
const marksRequest = (marks, extra = {}) => ({ json: async () => ({ attempt_id: "attempt-1", question_id: "written-dictation", marks, ...extra }) });

test("the teacher's marks regrade the dictation on the server", async () => {
  const answers = { "written-dictation": "Я знаю что он придёт и мы пойдём в лес." };
  const updates = setupMarks({ answers, result: grade(dictation, answers) });
  const response = await markDictation(marksRequest({ 0: "ignored", 1: "ignored" }), context);
  assert.equal(response.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].percentage, 100);
  const row = updates[0].result.per_question[0];
  assert.equal(row.score, 1);
  assert.equal(row.dictation.grade, 5);
  assert.deepEqual(row.dictation.marks, { 0: "ignored", 1: "ignored" });
  assert.equal(row.dictation.reference, reference, "the stored text is kept, not taken from the browser");
});

test("dictation marks are refused when invalid, for a hand-set total, or without a dictation", async () => {
  const answers = { "written-dictation": "Я знаю что он придёт и мы пойдём в лес." };
  const result = grade(dictation, answers);
  let updates = setupMarks({ answers, result });
  assert.equal((await markDictation(marksRequest({ 2: "ignored" }), context)).status, 400, "only existing mistakes");
  assert.equal((await markDictation(marksRequest({ 0: "half" }), context)).status, 400);
  assert.equal((await markDictation(marksRequest(null), context)).status, 400);
  assert.equal((await markDictation(marksRequest({}, { question_id: "other" }), context)).status, 404);
  assert.equal(updates.length, 0);
  updates = setupMarks({ answers, result: { ...result, manually_reviewed_by: "teacher-1" } });
  assert.equal((await markDictation(marksRequest({}), context)).status, 409);
  updates = setupMarks({ answers, result: { ...result, per_question: [{ ...result.per_question[0], dictation: { ...result.per_question[0].dictation, grade: 7 } }] } });
  assert.equal((await markDictation(marksRequest({}), context)).status, 404, "a tampered record is not trusted");
  assert.equal(updates.length, 0);
  globalThis.writtenMocks.actor = { id: "student-1", role: "student", accessToken: "token" };
  assert.equal((await markDictation(marksRequest({}), context)).status, 401);
});

test("a dictation in a work still waiting for an essay score keeps the total open", async () => {
  const variant = { ...dictation, questions: [dictation.questions[0], essay.questions[0]] };
  const answers = { "written-dictation": "Я знаю что он придёт и мы пойдём в лес.", "written-essay": "Текст." };
  const updates = setupMarks({ answers, result: grade(variant, answers) });
  assert.equal((await markDictation(marksRequest({ 0: "ignored" }), context)).status, 200);
  assert.equal(updates[0].percentage, null);
  assert.equal(updates[0].result.per_question[0].dictation.grade, 4);
});

function setupCreate() {
  const inserts = [];
  globalThis.writtenMocks = {
    actor: { id: "teacher-1", role: "teacher", accessToken: "token" },
    userDb: { from: () => ({
      insert: (row) => { inserts.push(row); return { select: () => ({ single: async () => ({ data: { id: "new-test" }, error: null }) }) }; },
      update: (patch) => { inserts.push(patch); return { eq() { return this; }, select() { return this; }, maybeSingle: async () => ({ data: { id: "t", status: "draft" }, error: null }) }; },
    }) },
  };
  return inserts;
}
const createRequest = (body) => ({ json: async () => body });

test("a teacher creates a written work without AI", async () => {
  const inserts = setupCreate();
  const response = await createWork(createRequest({ kind: "words", language: "kazakh", title: " Сөздер ", gradeLevel: "5", text: "кітап\nқалам" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "new-test" });
  const row = inserts[0];
  assert.equal(row.owner_id, "teacher-1");
  assert.equal(row.title, "Сөздер");
  assert.equal(row.status, "draft");
  assert.deepEqual(Object.keys(row.variants), ["Variant A"]);
  assert.equal(row.variants["Variant A"].questions[0].dictation_mode, "words");
  assert.equal(row.topic, "Сөздік диктант");
});

test("written work creation validates its input", async () => {
  const inserts = setupCreate();
  const base = { kind: "dictation", language: "russian", title: "Диктант", text: "Текст." };
  assert.equal((await createWork(createRequest({ ...base, kind: "poem" }))).status, 400);
  assert.equal((await createWork(createRequest({ ...base, language: "german" }))).status, 400);
  assert.equal((await createWork(createRequest({ ...base, title: "  " }))).status, 400);
  assert.equal((await createWork(createRequest({ ...base, text: "" }))).status, 400);
  assert.equal((await createWork(createRequest({ ...base, text: "а".repeat(6001) }))).status, 400);
  assert.equal((await createWork(createRequest({ ...base, text: "... !" }))).status, 400, "a text without words");
  assert.equal(inserts.length, 0);
  globalThis.writtenMocks.actor = { id: "s", role: "student", accessToken: "token" };
  assert.equal((await createWork(createRequest(base))).status, 401);
});

test("a saved test keeps either one written variant or all four", async () => {
  const inserts = setupCreate();
  const patch = (variants) => patchTest({ json: async () => ({ variants }) }, { params: Promise.resolve({ id: "t" }) });
  assert.equal((await patch({ "Variant A": dictation })).status, 200);
  assert.equal((await patch({ "Variant A": dictation, "Variant B": dictation, "Variant C": dictation, "Variant D": dictation })).status, 200);
  assert.equal((await patch({ "Variant B": dictation })).status, 400);
  assert.equal((await patch({ "Variant A": dictation, "Variant B": dictation })).status, 400);
  assert.equal((await patch({ "Variant A": dictation, "Variant B": dictation, "Variant C": dictation, "__proto__": dictation })).status, 400);
  assert.equal(inserts.length, 2);
});
