import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizedClassStudents, normalizedStudentName, parseRoster, rosterFromBody } from "../lib/classes.ts";
import { rosterNameFor } from "../lib/roster-names.ts";
import { studentIdentity } from "../lib/student-names.ts";
import { classProgress } from "../lib/progress.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a pasted roster reads 'Фамилия Имя, email' in any order and plain emails as before", () => {
  const { entries, invalid } = parseRoster([
    "Серикова Айгерим, Aigerim@Gmail.com",
    "nurlan@school.kz\tАхметов Нурлан",
    "Ким  Виктор <viktor@mail.ru>",
    "Ли Анна — anna@mail.ru",
    "a@school.kz, b@school.kz; c@school.kz",
    "   ",
  ].join("\n"));
  assert.deepEqual(invalid, []);
  assert.deepEqual(entries, [
    { email: "aigerim@gmail.com", full_name: "Серикова Айгерим" },
    { email: "nurlan@school.kz", full_name: "Ахметов Нурлан" },
    { email: "viktor@mail.ru", full_name: "Ким Виктор" },
    { email: "anna@mail.ru", full_name: "Ли Анна" },
    { email: "a@school.kz", full_name: null },
    { email: "b@school.kz", full_name: null },
    { email: "c@school.kz", full_name: null },
  ]);
});

test("lines without an email, with two emails and a name, or with a bad name are returned to the teacher", () => {
  const { entries, invalid } = parseRoster("Только Имя\nИванов a@x.kz b@x.kz\n12345 d@x.kz\nok@x.kz\n" + "Я".repeat(121) + " long@x.kz");
  assert.deepEqual(entries, [{ email: "ok@x.kz", full_name: null }]);
  assert.equal(invalid.length, 4);
});

test("student names are trimmed and must contain letters, without control characters", () => {
  assert.equal(normalizedStudentName("  Серикова   Айгерим "), "Серикова Айгерим");
  assert.equal(normalizedStudentName(""), null);
  assert.equal(normalizedStudentName(null), null);
  assert.equal(normalizedStudentName("123"), undefined);
  assert.equal(normalizedStudentName("Анна\u0000"), undefined);
  assert.equal(normalizedStudentName("Анна​"), undefined);
  assert.equal(normalizedStudentName(42), undefined);
  assert.equal(normalizedStudentName("Я".repeat(121)), undefined);
});

test("the server roster check deduplicates by email and keeps a typed name", () => {
  assert.deepEqual(normalizedClassStudents([
    { email: "A@x.kz", full_name: "Ахметов Нурлан" }, { email: "a@x.kz" }, { email: "b@x.kz", full_name: "" },
  ]), [{ email: "a@x.kz", full_name: "Ахметов Нурлан" }, { email: "b@x.kz", full_name: null }]);
  assert.equal(normalizedClassStudents([{ email: "bad" }]), null);
  assert.equal(normalizedClassStudents([{ email: "a@x.kz", full_name: "1" }]), null);
  assert.equal(normalizedClassStudents(["a@x.kz"]), null);
  assert.equal(normalizedClassStudents(Array(101).fill({ email: "a@x.kz" })), null);
  assert.deepEqual(rosterFromBody({ emails: ["A@x.kz"] }), [{ email: "a@x.kz", full_name: null }]);
});

test("the typed roster name comes first, with the email beneath it", () => {
  assert.deepEqual(studentIdentity("Aigerim.S", "aigerim.s@gmail.com", "Серикова Айгерим"), { name: "Серикова Айгерим", email: "aigerim.s@gmail.com" });
  assert.deepEqual(studentIdentity("Айгерим", "a@x.kz", "  "), { name: "Айгерим", email: "a@x.kz" });
  const { rows } = classProgress([
    { email: "z@x.kz", student_id: null, full_name: "Ахметов Нурлан" },
    { email: "a@x.kz", student_id: "s1", full_name: null },
  ], [], [], new Map([["s1", "Болат"]]));
  assert.deepEqual(rows.map(row => [row.name, row.email]), [["Ахметов Нурлан", "z@x.kz"], ["Болат", "a@x.kz"]]);
});

test("an attempt takes the name from the link's class, else from another class of the teacher", () => {
  const pick = rosterNameFor([
    { class_id: "c2", student_id: "s1", full_name: "Сериков Айгерим (7Б)" },
    { class_id: "c1", student_id: "s1", full_name: "Серикова Айгерим" },
  ]);
  assert.equal(pick("s1", "c2"), "Сериков Айгерим (7Б)");
  assert.equal(pick("s1", null), "Серикова Айгерим");
  assert.equal(pick("s1", "other"), "Серикова Айгерим");
  assert.equal(pick("s2", "c1"), null);
});

test("roster names are read with the teacher's own client and a name never clears from an email-only line", () => {
  const results = read("../app/api/tests/[id]/attempts/route.ts");
  assert.match(results, /rosterNames\(db, studentIds\)/);
  assert.match(results, /if \(!profiles \|\| !roster \|\| linksError\) return jsonError/);
  const members = read("../app/api/classes/[id]/members/route.ts");
  assert.match(members, /\[\[named, false\], \[unnamed, true\]\]/);
  assert.match(members, /\.map\(\(\{ email \}\) => \(\{ class_id: id, email \}\)\)/);
  const member = read("../app/api/classes/[id]/members/[memberId]/route.ts");
  assert.match(member, /export async function PATCH[\s\S]*actor\.role !== "teacher"[\s\S]*\.eq\("owner_id", actor\.id\)\.eq\("is_active", true\)/);
});

test("the database limits the typed name, in the migration and both base schemas", () => {
  for (const file of ["../supabase_class_member_names.sql", "../supabase_google_classes.sql", "../supabase_v2.sql"]) {
    const sql = read(file);
    assert.match(sql, /add column if not exists full_name text/);
    assert.match(sql, /char_length\(full_name\) between 1 and 120/);
  }
});
