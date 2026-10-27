import test from "node:test";
import assert from "node:assert/strict";
import { analyzeVariant } from "../lib/analytics.ts";
import { answerReview } from "../lib/assessment.ts";

const questions = [
  { id: "q1", type: "multiple_choice", question: "2 + 2?", options: ["3", "4", "5"], correct_answer: "4", explanation: "Add", skill_tag: "" },
  { id: "q2", type: "short_answer", question: "Capital?", correct_answer: "Astana", explanation: "", skill_tag: "" },
];
const attempt = (id, name, answers, scores) => ({
  id, student_name: name, variant_name: "Variant A", answers,
  result: { per_question: scores.map(([qid, score, review]) => ({ id: qid, score, requires_manual_review: Boolean(review) })) },
});
const attempts = [
  attempt("a1", "Aigerim", { q1: "4", q2: "Astana" }, [["q1", 1], ["q2", 1]]),
  attempt("a2", "Bolat", { q1: "3", q2: "Almaty" }, [["q1", 0], ["q2", 0]]),
  attempt("a3", "Dana", { q1: "3", q2: "astana city" }, [["q1", 0], ["q2", 0, true]]),
  attempt("a4", "Erlan", { q1: "5" }, [["q1", 0], ["q2", 0]]),
  { ...attempt("b1", "Other", { q1: "4" }, [["q1", 1]]), variant_name: "Variant B" },
];

test("the heat map has one row per student of the variant and one cell per question", () => {
  const data = analyzeVariant("Variant A", attempts, questions);
  assert.equal(data.attempts, 4);
  assert.deepEqual(data.rows.map(row => row.student), ["Aigerim", "Bolat", "Dana", "Erlan"]);
  assert.deepEqual(data.rows[0].cells, [1, 1]);
  assert.deepEqual(data.rows[2].cells, [0, null], "an answer awaiting review is not counted as wrong");
  assert.equal(data.rows[0].total, 1);
  assert.equal(data.rows[2].total, null);
});

test("question stats find the hard question and its most common wrong answer", () => {
  const [q1, q2] = analyzeVariant("Variant A", attempts, questions).questions;
  assert.equal(q1.average, 0.25);
  assert.equal(q1.level, "hard");
  assert.deepEqual(q1.wrongAnswers, [{ answer: "3", count: 2 }, { answer: "5", count: 1 }]);
  assert.equal(q2.graded, 3);
  assert.equal(q2.unanswered, 1);
  assert.deepEqual(q2.wrongAnswers, [], "free-text answers are not grouped");
});

test("questions removed from the test after sharing still appear by number", () => {
  const data = analyzeVariant("Variant A", attempts, [questions[1]]);
  assert.equal(data.questions[0].text, "");
  assert.equal(data.questions[1].text, "Capital?");
});

test("the student review shows answers, the key and pending checks", () => {
  const review = answerReview({ title: "T", instructions: "", questions }, { q1: "3", q2: "astana city" }, attempts[2].result);
  assert.deepEqual(review.map(item => [item.given, item.correct, item.score]), [["3", "4", 0], ["astana city", "Astana", null]]);
  assert.equal(review[0].explanation, "Add");
  assert.deepEqual(answerReview({ title: "T", instructions: "", questions }, {}, null).map(item => item.given), ["", ""]);
});

test("a teacher's manual review does not hide the auto-graded answers", () => {
  // The review route clears every per-question score and stores only the total.
  const reviewed = { id: "r1", student_name: "Reviewed", variant_name: "Variant A", answers: { q1: "4", q2: "astana city" },
    result: { manually_reviewed_by: "teacher-1", per_question_scoring: "unscored", per_question: [{ id: "q1", score: null }, { id: "q2", score: null }] } };
  const data = analyzeVariant("Variant A", [reviewed], questions);
  assert.deepEqual(data.rows[0].cells, [1, null]);
  const review = answerReview({ title: "T", instructions: "", questions }, reviewed.answers, reviewed.result);
  assert.deepEqual(review.map(item => [item.score, item.checked]), [[1, false], [null, true]]);
});

test("questions from another version of the variant do not erase a student's total", () => {
  const otherLink = { id: "o1", student_name: "Other link", variant_name: "Variant A", answers: { q1: "4", q3: "x" },
    result: { per_question: [{ id: "q1", score: 1 }, { id: "q3", score: 0 }] } };
  const mine = { id: "m1", student_name: "This link", variant_name: "Variant A", answers: { q1: "4", q2: "Astana" },
    result: { per_question: [{ id: "q1", score: 1 }, { id: "q2", score: 1 }] } };
  const data = analyzeVariant("Variant A", [mine, otherLink], questions);
  const row = data.rows.find(item => item.student === "This link");
  assert.deepEqual(row.cells, [1, 1, "absent"]);
  assert.equal(row.total, 1);
  assert.equal(data.rows.find(item => item.student === "Other link").total, 0.5);
});

test("a manual review keeps the auto-graded score that analytics shows", () => {
  const reviewed = { id: "r2", student_name: "R", variant_name: "Variant A", answers: { q1: "3" },
    result: { manually_reviewed_by: "t", per_question: [{ id: "q1", score: null, auto_score: 1 }] } };
  // auto_score wins over rescoring with today's (possibly edited) key.
  assert.deepEqual(analyzeVariant("Variant A", [reviewed], questions).rows[0].cells, [1]);
});
