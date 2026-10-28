import test from "node:test";
import assert from "node:assert/strict";
import { grade, studentVariant, scrambled } from "../lib/assessment.ts";
import { questionProblem } from "../lib/question-validation.ts";

const select = { id: "s1", type: "multiple_select", question: "Which are prime?", options: ["2", "3", "4", "9"], correct_answers: ["2", "3"], correct_answer: "", explanation: "", skill_tag: "" };
const order = { id: "o1", type: "ordering", question: "Smallest to largest", items: ["1/4", "1/3", "1/2", "1"], correct_answer: "", explanation: "", skill_tag: "" };
const variant = { title: "T", instructions: "", questions: [select, order] };

test("multiple select: each wrong tick cancels a right one", () => {
  const score = (answer) => grade({ ...variant, questions: [select] }, { s1: answer }).per_question[0].score;
  assert.equal(score(["2", "3"]), 1);
  assert.equal(score(["3"]), 0.5);
  assert.equal(score(["2", "3", "4"]), 0.5);
  assert.equal(score(["2", "3", "4", "9"]), 0, "ticking everything scores nothing");
  assert.equal(score([" 2 ", "3"]), 1);
  assert.equal(score("2"), 0);
  assert.equal(score(undefined), 0);
});

test("ordering scores the share of items in their right place", () => {
  const score = (answer) => grade({ ...variant, questions: [order] }, { o1: answer }).per_question[0].score;
  assert.equal(score(["1/4", "1/3", "1/2", "1"]), 1);
  assert.equal(score(["1/3", "1/4", "1/2", "1"]), 0.5);
  assert.equal(score(["1", "1/2", "1/3", "1/4"]), 0);
  // A non-list answer means the student never moved the items: the order shown counts.
  assert.equal(score({}), score(scrambled(order.items, order.id)));
  assert.equal(grade(variant, { s1: ["2", "3"], o1: ["1/4", "1/3", "1/2", "1"] }).percentage, 100);
});

test("students never get the answers of the new types", () => {
  const shown = studentVariant(variant);
  assert.equal(JSON.stringify(shown).includes("correct_answers"), false);
  assert.deepEqual([...shown.questions[1].items].sort(), [...order.items].sort());
  assert.notDeepEqual(shown.questions[1].items, order.items, "the starting order is never the answer");
  for (const items of [["a", "b"], ["a", "b", "c"], ["x", "y", "z", "w", "v"]]) {
    for (const seed of ["q1", "q2", "q3", "q4", "q5", "q6"]) assert.notDeepEqual(scrambled(items, seed), items);
  }
});

test("validation of the new types", () => {
  assert.equal(questionProblem(select), null);
  assert.equal(questionProblem({ ...select, correct_answers: [] }), "correct_answers_missing");
  assert.equal(questionProblem({ ...select, correct_answers: ["7"] }), "correct_answers_missing");
  assert.equal(questionProblem({ ...select, options: ["2", "3"] }), "options_count");
  assert.equal(questionProblem({ ...select, correct_answers: undefined }), "invalid");
  assert.equal(questionProblem(order), null);
  assert.equal(questionProblem({ ...order, items: ["a", "b"] }), "items_count");
  assert.equal(questionProblem({ ...order, items: ["a", "b", ""] }), "items_empty");
  assert.equal(questionProblem({ ...order, items: ["a", "b", "A"] }), "items_duplicate");
});

test("an ordering question left as shown is graded on the order the student saw", () => {
  const shown = studentVariant({ ...variant, questions: [order] }).questions[0].items;
  const expected = order.items.filter((item, i) => shown[i] === item).length / order.items.length;
  const result = grade({ ...variant, questions: [order] }, {});
  assert.equal(result.per_question[0].score, expected);
  assert.equal(result.percentage, Math.round(expected * 10000) / 100);
});

test("a multiple-select question needs at least one wrong option", () => {
  assert.equal(questionProblem({ ...select, correct_answers: ["2", "3", "4", "9"] }), "correct_answers_all");
});

test("ticking every option scores 0 whatever the mix of right and wrong options", () => {
  const many = { ...select, options: ["2", "3", "5", "9"], correct_answers: ["2", "3", "5"] };
  const score = (answer) => grade({ ...variant, questions: [many] }, { s1: answer }).per_question[0].score;
  assert.equal(score(["2", "3", "5", "9"]), 0);
  assert.equal(score(["2", "3", "5"]), 1);
  assert.equal(Math.round(score(["2", "3"]) * 1000) / 1000, 0.667);
  const five = { ...select, options: ["a", "b", "c", "d", "e"], correct_answers: ["a", "b", "c", "d"] };
  assert.equal(grade({ ...variant, questions: [five] }, { s1: ["a", "b", "c", "d", "e"] }).per_question[0].score, 0);
});

test("the ordering shuffle cannot be undone from the public question id", async () => {
  const { scrambledOrder } = await import("../lib/scramble.ts");
  const items = ["1", "2", "3", "4", "5", "6"];
  process.env.ORDERING_SEED_SECRET = "server-only-secret";
  const shown = scrambled(items, "q-public-id");
  // What a student could compute from the id alone does not match what the server shows.
  const guesses = [scrambledOrder(items, "q-public-id"), scrambledOrder(items, "q-public-id:items")];
  assert.ok(guesses.every(guess => JSON.stringify(guess) !== JSON.stringify(shown)));
  process.env.ORDERING_SEED_SECRET = "another-secret";
  assert.notDeepEqual(scrambled(items, "q-public-id"), shown, "the order depends on the server secret");
  delete process.env.ORDERING_SEED_SECRET;
});

test("a solved ordering question does not reveal another test's question with the same id", () => {
  process.env.ORDERING_SEED_SECRET = "server-only-secret";
  const a = ["a1", "a2", "a3", "a4"];
  const b = ["b1", "b2", "b3", "b4"];
  const permutation = (items) => scrambled(items, "easy-1").map(item => items.indexOf(item));
  assert.notDeepEqual(permutation(a), permutation(b));
  delete process.env.ORDERING_SEED_SECRET;
});
