import test from "node:test";
import assert from "node:assert/strict";
import { classProgress } from "../lib/progress.ts";

const members = [{ email: "b@school.kz", student_id: "s2" }, { email: "a@school.kz", student_id: "s1" }, { email: "new@school.kz", student_id: null }];
const tests = [{ id: "t3", title: "Third" }, { id: "t1", title: "First" }, { id: "t2", title: "Second" }, { id: "t9", title: "Never taken" }];
const attempts = [
  { test_id: "t1", student_id: "s1", percentage: 40, submitted_at: "2026-09-01T08:00:00Z" },
  { test_id: "t2", student_id: "s1", percentage: null, submitted_at: "2026-09-15T08:00:00Z" },
  { test_id: "t3", student_id: "s1", percentage: 90, submitted_at: "2026-10-01T08:00:00Z" },
  { test_id: "t1", student_id: "s2", percentage: 80, submitted_at: "2026-09-01T09:00:00Z" },
  { test_id: "t3", student_id: "s2", percentage: 60, submitted_at: "2026-10-01T09:00:00Z" },
  { test_id: "t1", student_id: "outsider", percentage: 100, submitted_at: "2026-08-01T09:00:00Z" },
];

test("tests appear in the order the class took them; untaken tests are left out", () => {
  assert.deepEqual(classProgress(members, tests, attempts).columns.map(test => test.id), ["t1", "t2", "t3"]);
});

test("each student gets cells, an average of graded work and a trend from first to last", () => {
  const { rows } = classProgress(members, tests, attempts);
  assert.deepEqual(rows.map(row => row.email), ["a@school.kz", "b@school.kz", "new@school.kz"]);
  assert.deepEqual(rows[0], { name: null, email: "a@school.kz", cells: [40, "pending", 90], average: 65, trend: 50 });
  assert.deepEqual(rows[1], { name: null, email: "b@school.kz", cells: [80, null, 60], average: 70, trend: -20 });
  assert.deepEqual(rows[2], { name: null, email: "new@school.kz", cells: [null, null, null], average: null, trend: null });
});

test("students outside the class never show up", () => {
  assert.equal(JSON.stringify(classProgress(members, tests, attempts)).includes("outsider"), false);
});
