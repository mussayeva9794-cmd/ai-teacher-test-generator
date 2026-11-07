import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// POST /api/tests/[id]/attempts/reset: only the test owner, and the attempt must belong to that test.
const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => globalThis.resetMocks.actor; export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/supabase", "export const userClient = () => globalThis.resetMocks.owner;"],
  ["@/lib/supabase-admin", "export const adminClient = () => globalThis.resetMocks.admin;"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/tests/[id]/attempts/reset/route.ts");

function setup({ ownsTest = true, attempt = { id: "a1", link_id: "l1", student_id: "s1" }, failTable = "" } = {}) {
  const deleted = [];
  const query = (table, rows) => {
    const q = { eq: () => q, match: () => q, select: () => q, maybeSingle: async () => ({ data: rows, error: null }) };
    q.delete = () => { deleted.push(table); return { eq: () => ({ eq: async () => ({ error: failTable === table ? { code: "XX000" } : null }) }), match: async () => ({ error: failTable === table ? { code: "XX000" } : null }) }; };
    return q;
  };
  globalThis.resetMocks = {
    actor: { id: "t1", role: "teacher", accessToken: "x" },
    owner: { from: (table) => query(table, ownsTest ? { id: "test1" } : null) },
    admin: { from: (table) => query(table, table === "web_attempts" ? attempt : null) },
  };
  return deleted;
}
const call = (body = { attempt_id: "a1" }) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "test1" }) });

test("owner resets an attempt: strict state, events, then the attempt itself", async () => {
  const deleted = setup();
  const response = await call();
  assert.equal(response.status, 200);
  assert.deepEqual(deleted, ["web_strict_question_windows", "web_strict_attempt_state", "web_attempt_events", "web_attempts"]);
});

test("a teacher who does not own the test deletes nothing", async () => {
  const deleted = setup({ ownsTest: false });
  assert.equal((await call()).status, 404);
  assert.deepEqual(deleted, []);
});

test("an attempt of another test is not found", async () => {
  const deleted = setup({ attempt: null });
  assert.equal((await call()).status, 404);
  assert.deepEqual(deleted, []);
});

test("a failed cleanup step keeps the attempt", async () => {
  const deleted = setup({ failTable: "web_attempt_events" });
  assert.equal((await call()).status, 503);
  assert.ok(!deleted.includes("web_attempts"));
});

test("students cannot reset", async () => {
  setup();
  globalThis.resetMocks.actor = { id: "s1", role: "student" };
  assert.equal((await call()).status, 401);
});
