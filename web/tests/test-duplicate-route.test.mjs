import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// POST /api/tests/[id]/duplicate: a draft copy of the teacher's own test only.
const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => globalThis.dupMocks.actor; export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/supabase", "export const userClient = () => globalThis.dupMocks.db;"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/tests/[id]/duplicate/route.ts");

function setup(source) {
  const inserted = [];
  const filters = [];
  const q = { select: () => q, eq: (c, v) => { filters.push([c, v]); return q; }, maybeSingle: async () => ({ data: source, error: null }), single: async () => ({ data: { id: "new" }, error: null }) };
  globalThis.dupMocks = { actor: { id: "t1", role: "teacher", accessToken: "x" }, db: { from: () => ({ ...q, insert: (row) => { inserted.push(row); return q; } }) } };
  return { inserted, filters };
}
const call = () => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "old" }) });

test("copies the test as a private draft with a language-aware title", async () => {
  const { inserted, filters } = setup({ title: "Дроби", topic: "Math", language: "russian", grade_level: "5", variants: { "Variant A": {} } });
  const response = await call();
  assert.deepEqual(await response.json(), { id: "new" });
  assert.deepEqual(filters, [["id", "old"], ["owner_id", "t1"]]);
  assert.equal(inserted[0].title, "Дроби (копия)");
  assert.equal(inserted[0].status, "draft");
  assert.equal(inserted[0].owner_id, "t1");
});

test("another teacher's test is not found and nothing is inserted", async () => {
  const { inserted } = setup(null);
  assert.equal((await call()).status, 404);
  assert.deepEqual(inserted, []);
});

test("students cannot duplicate", async () => {
  setup({});
  globalThis.dupMocks.actor = { id: "s1", role: "student" };
  assert.equal((await call()).status, 401);
});
