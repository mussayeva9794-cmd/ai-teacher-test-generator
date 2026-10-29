import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// GET /api/my/attempts against a fake admin database.
const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => globalThis.myMocks.actor; export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/supabase-admin", "export const adminClient = () => globalThis.myMocks.db;"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { GET } = await import("../app/api/my/attempts/route.ts");

function fakeDb(tables) {
  const queries = [];
  return { queries, from(table) {
    const calls = [];
    queries.push({ table, calls });
    const finish = () => {
      const select = calls.find(([name]) => name === "select")?.[1] || "";
      if (table === "web_share_links" && tables.noClassColumn && select.includes("class_id")) {
        return { data: null, error: { code: "42703", message: "column web_share_links.class_id does not exist" } };
      }
      let rows = tables[table] || [];
      for (const [name, column, value] of calls) {
        if (name === "eq") rows = rows.filter((row) => row[column] === value);
        if (name === "in") rows = rows.filter((row) => value.includes(row[column]));
      }
      return { data: rows, error: null };
    };
    const query = { then: (resolve, reject) => Promise.resolve(finish()).then(resolve, reject) };
    for (const name of ["select", "eq", "in", "order", "limit"]) query[name] = (...args) => { calls.push([name, ...args]); return query; };
    return query;
  } };
}

const student = { id: "s1", role: "student", email: "s1@school.kz", emailVerified: true, hasGoogleIdentity: true, googleEmail: "s1@school.kz" };
const at = (id, link_id, percentage = 90) => ({ id, test_id: "t1", link_id, student_id: "s1", percentage, submitted_at: "2026-10-01T10:00:00Z" });
const base = {
  web_attempts: [at("a1", "open"), at("a2", "closedClass"), at("a3", "removed"), at("a4", "listed"), at("a5", "notListed"), { ...at("x", "open"), student_id: "other" }],
  web_tests: [{ id: "t1", title: "Дроби", topic: null, status: "published" }],
  web_share_links: [
    { id: "open", token: "T-open", settings: { reveal_score: true }, is_active: true, class_id: "c1" },
    { id: "closedClass", token: "T-closed", settings: {}, is_active: true, class_id: "c2" },
    { id: "removed", token: "T-removed", settings: {}, is_active: true, class_id: "c3" },
    { id: "listed", token: "T-listed", settings: { allowed_students: ["s1@school.kz"] }, is_active: true, class_id: null },
    { id: "notListed", token: "T-not", settings: { allowed_students: ["x@school.kz"] }, is_active: true, class_id: null },
  ],
  web_classes: [{ id: "c1", is_active: true }, { id: "c2", is_active: false }, { id: "c3", is_active: true }],
  web_class_members: [{ class_id: "c1", student_id: "s1", email: "s1@school.kz" }, { class_id: "c2", student_id: "s1", email: "s1@school.kz" }],
};
const run = async (tables, actor = student) => {
  globalThis.myMocks = { actor, db: fakeDb(tables) };
  const response = await GET({});
  return { status: response.status, body: await response.json() };
};

test("only the signed-in student's attempts are listed", async () => {
  const { body } = await run(base);
  assert.deepEqual(body.attempts.map((row) => row.id), ["a1", "a2", "a3", "a4", "a5"]);
});

test("the result link is offered only where the test page would let the student in", async () => {
  const { body } = await run(base);
  assert.deepEqual(Object.fromEntries(body.attempts.map((row) => [row.id, row.href])), {
    a1: "/s/T-open", a2: null, a3: null, a4: "/s/T-listed", a5: null,
  });
  assert.deepEqual(body.attempts[0].score, { state: "shown", percentage: 90 });
  assert.deepEqual(body.attempts[1].score, { state: "hidden" });
});

test("teachers and signed-out visitors get no list", async () => {
  assert.equal((await run(base, { ...student, role: "teacher" })).status, 403);
  assert.equal((await run(base, null)).status, 401);
});

test("a database without the class migration still lists the tests", async () => {
  const { status, body } = await run({ ...base, noClassColumn: true });
  assert.equal(status, 200);
  assert.equal(body.attempts.length, 5);
});
