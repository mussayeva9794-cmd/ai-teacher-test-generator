import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { myAttempts } from "../lib/my-attempts.ts";

const tests = [
  { id: "t1", title: "Дроби", topic: "Математика", status: "published" },
  { id: "t2", title: "Проценты", topic: null, status: "archived" },
];
const links = [
  { id: "l1", token: "tok1", settings: { reveal_score: true }, is_active: true },
  { id: "l2", token: "tok2", settings: {}, is_active: true },
  { id: "l3", token: "tok3", settings: { reveal_score: true }, is_active: false },
];
const attempt = (id, test_id, link_id, percentage) => ({ id, test_id, link_id, percentage, submitted_at: "2026-10-01T10:00:00Z" });

test("a student's tests show the score only where the teacher reveals it", () => {
  const rows = myAttempts([
    attempt("a1", "t1", "l1", 85), attempt("a2", "t1", "l2", 85), attempt("a3", "t1", "l1", null), attempt("a4", "t2", "l3", 70),
  ], tests, links);
  assert.deepEqual(rows.map(row => row.score), [
    { state: "shown", percentage: 85 }, { state: "hidden" }, { state: "pending" }, { state: "shown", percentage: 70 },
  ]);
});

test("the result opens through the test link only while the link is open and the test published", () => {
  const rows = myAttempts([attempt("a1", "t1", "l1", 85), attempt("a4", "t2", "l3", 70), attempt("a5", "t1", "gone", 50)], tests, links);
  assert.deepEqual(rows.map(row => row.href), ["/s/tok1", null, null]);
  assert.equal(rows[2].score.state, "hidden");
});

test("an attempt whose test is gone is left out", () => {
  assert.deepEqual(myAttempts([attempt("a1", "missing", "l1", 85)], tests, links), []);
});

test("the route reads only the signed-in student's own attempts", () => {
  const route = readFileSync(new URL("../app/api/my/attempts/route.ts", import.meta.url), "utf8");
  assert.match(route, /actor\.role !== "student"\) return jsonError\("Student account required\.", 403\)/);
  assert.match(route, /\.eq\("student_id", actor\.id\)/);
  // No answers or grading details leave the server through this list.
  assert.doesNotMatch(route, /select\([^)]*answers/);
});
