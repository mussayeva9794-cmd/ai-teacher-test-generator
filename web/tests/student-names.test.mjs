import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { studentIdentity } from "../lib/student-names.ts";
import { classProgress } from "../lib/progress.ts";

test("a real name is shown with the email beneath it", () => {
  assert.deepEqual(studentIdentity("Айгерим Серикова", "aigerim.s@gmail.com"), { name: "Айгерим Серикова", email: "aigerim.s@gmail.com" });
});

test("a name that is only the email's start, or no name, shows the email once", () => {
  assert.deepEqual(studentIdentity("Aigerim.S", "aigerim.s@gmail.com"), { name: "aigerim.s@gmail.com", email: null });
  assert.deepEqual(studentIdentity("  ", "a@school.kz"), { name: "a@school.kz", email: null });
  assert.deepEqual(studentIdentity(null, null), { name: "Student", email: null });
  assert.deepEqual(studentIdentity("Asel", null), { name: "Asel", email: null });
});

test("class progress shows signed-in students by name, sorted by what is shown", () => {
  const members = [{ email: "z@school.kz", student_id: "s1" }, { email: "b@school.kz", student_id: null }, { email: "c@school.kz", student_id: "s2" }];
  const names = new Map([["s1", "Айдана"], ["s2", "c"]]);
  const { rows } = classProgress(members, [], [], names);
  assert.deepEqual(rows.map(row => [row.name, row.email]), [[null, "b@school.kz"], [null, "c@school.kz"], ["Айдана", "z@school.kz"]]);
});

test("results route sends the email and a spreadsheet-safe copy for CSV", () => {
  const route = readFileSync(new URL("../app/api/tests/[id]/attempts/route.ts", import.meta.url), "utf8");
  assert.match(route, /student_email:\s*identity\.email/);
  assert.match(route, /csv_student_email:\s*spreadsheetSafeText\(identity\.email \?\? ""\)/);
  const page = readFileSync(new URL("../app/tests/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /a\.csv_student_email \?\? ""/);
});

test("email lookups stay on the server and are limited to ids the caller passes", () => {
  const lookup = readFileSync(new URL("../lib/student-lookup.ts", import.meta.url), "utf8");
  assert.match(lookup, /^import "server-only";/);
  assert.match(lookup, /getUserById\(id\)/);
});
