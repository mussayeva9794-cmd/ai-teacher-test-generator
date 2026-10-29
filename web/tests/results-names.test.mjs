import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The results route and roster-name lookup against a fake database, including
// one where the class migrations were never applied.
const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => ({ id: 'teacher-1', role: 'teacher', accessToken: 'token' }); export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/supabase", "export const userClient = () => globalThis.resultsMocks.db;"],
  ["@/lib/supabase-admin", "export const adminClient = () => ({ rpc: async () => ({ data: [], error: null }) });"],
  ["@/lib/student-lookup", "export const studentProfiles = async (ids) => new Map(ids.map((id) => [id, { name: 'Profile ' + id, email: id + '@school.kz' }]));"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { GET } = await import("../app/api/tests/[id]/attempts/route.ts");
const { rosterNames } = await import("../lib/roster-names.ts");
const { isMissingRosterNameSchema } = await import("../lib/schema-compat.ts");

/** respond(table, calls) returns { data, error, count? } for each finished query. */
function fakeDb(respond) {
  const queries = [];
  return { queries, rpc: async () => ({ data: [{ total_count: 1, graded_count: 1, pending_review: 0, average: 80 }], error: null }), from(table) {
    const calls = [];
    queries.push({ table, calls });
    const query = {
      then: (resolve, reject) => Promise.resolve(respond(table, calls)).then(resolve, reject),
      maybeSingle: async () => respond(table, calls),
    };
    for (const name of ["select", "eq", "in", "not", "order", "range", "or", "limit"]) query[name] = (...args) => { calls.push([name, ...args]); return query; };
    return query;
  } };
}

const attempt = { id: "a1", link_id: "l1", student_id: "s1", variant_name: "A", percentage: 80, answers: {}, result: {}, submitted_at: "2026-10-01T00:00:00Z" };
const request = { nextUrl: new URL("https://x.test/api/tests/t1/attempts") };
const context = { params: Promise.resolve({ id: "t1" }) };
const missingClassId = { code: "42703", message: "column web_share_links.class_id does not exist" };
const missingTable = { code: "PGRST205", message: "Could not find the table 'public.web_class_members' in the schema cache" };

test("results still load with profile names when the class migrations are missing", async () => {
  globalThis.resultsMocks = { db: fakeDb((table) => ({
    web_tests: { data: { id: "t1" }, error: null },
    web_attempts: { data: [attempt], error: null, count: 1 },
    web_share_links: { data: null, error: missingClassId },
    web_class_members: { data: null, error: missingTable },
  })[table]) };
  const response = await GET(request, context);
  assert.equal(response.status, 200);
  const { attempts } = await response.json();
  assert.equal(attempts[0].student_name, "Profile s1");
  assert.equal(attempts[0].student_email, "s1@school.kz");
});

test("any other failure to read links is still an error, not a silent fallback", async () => {
  globalThis.resultsMocks = { db: fakeDb((table) => ({
    web_tests: { data: { id: "t1" }, error: null },
    web_attempts: { data: [attempt], error: null, count: 1 },
    web_share_links: { data: null, error: { code: "57014", message: "timeout" } },
    web_class_members: { data: [], error: null },
  })[table]) };
  assert.equal((await GET(request, context)).status, 503);
});

test("the typed name in the link's class is shown before the profile name", async () => {
  globalThis.resultsMocks = { db: fakeDb((table) => ({
    web_tests: { data: { id: "t1" }, error: null },
    web_attempts: { data: [attempt], error: null, count: 1 },
    web_share_links: { data: [{ id: "l1", class_id: "c2" }], error: null },
    web_class_members: { data: [{ class_id: "c1", student_id: "s1", full_name: "Другое Имя" }, { class_id: "c2", student_id: "s1", full_name: "Серикова Айгерим" }], error: null },
  })[table]) };
  const { attempts } = await (await GET(request, context)).json();
  assert.equal(attempts[0].student_name, "Серикова Айгерим");
  assert.equal(attempts[0].student_email, "s1@school.kz");
});

test("roster names are read page by page, not cut at the first 1000 rows", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ class_id: `c${i}`, student_id: "s1", full_name: "Имя" }));
  const db = fakeDb((_table, calls) => {
    const [, from, to] = calls.find(([name]) => name === "range");
    return { data: rows.slice(from, to + 1), error: null };
  });
  assert.equal((await rosterNames(db, ["s1"])).length, 2500);
  assert.equal(db.queries.length, 3);
});

test("roster names are empty without the migrations and null on other errors", async () => {
  assert.deepEqual(await rosterNames(fakeDb(() => ({ data: null, error: missingTable })), ["s1"]), []);
  assert.deepEqual(await rosterNames(fakeDb(() => ({ data: null, error: { code: "42703", message: "column web_class_members.full_name does not exist" } })), ["s1"]), []);
  assert.equal(await rosterNames(fakeDb(() => ({ data: null, error: { code: "57014", message: "timeout" } })), ["s1"]), null);
  assert.equal(isMissingRosterNameSchema({ code: "42703", message: "column x.other does not exist" }), false);
});
