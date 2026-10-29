import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The roster routes against a recorded fake database: what is written, and when nothing is.
const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => globalThis.rosterMocks.actor; export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/supabase", "export const userClient = () => globalThis.rosterMocks.db;"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    // Real helpers such as @/lib/classes load from the source tree.
    if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/classes/[id]/members/route.ts");
const { PATCH } = await import("../app/api/classes/[id]/members/[memberId]/route.ts");

/** respond(table, calls) returns { data, error } for each finished query. */
function setup(respond) {
  const writes = [];
  const db = { rpc: async (name, args) => { writes.push({ table: "rpc", kind: name, payload: args }); return respond("rpc", [["rpc", name, args]]); }, from(table) {
    const calls = [];
    const finish = () => {
      const write = calls.find(([name]) => name === "upsert" || name === "update");
      if (write) writes.push({ table, kind: write[0], payload: write[1], options: write[2] });
      return respond(table, calls);
    };
    const query = {
      then: (resolve, reject) => Promise.resolve(finish()).then(resolve, reject),
      maybeSingle: async () => finish(),
    };
    for (const name of ["select", "eq", "in", "update", "upsert"]) query[name] = (...args) => { calls.push([name, ...args]); return query; };
    return query;
  } };
  globalThis.rosterMocks = { actor: { id: "teacher-1", role: "teacher", accessToken: "token" }, db };
  return writes;
}

const activeClass = (table) => table === "web_classes" ? { data: { id: "c1" }, error: null } : null;
const body = (value) => ({ json: async () => value });
const classContext = { params: Promise.resolve({ id: "c1" }) };
const memberContext = { params: Promise.resolve({ id: "c1", memberId: "m1" }) };

test("adding students is one database call that the SQL function makes name-preserving", async () => {
  const writes = setup((table) => activeClass(table) ?? { data: 3, error: null });
  const response = await POST(body({ students: [
    { email: "Old@x.kz" }, { email: "new@x.kz", full_name: " Ахметов  Нурлан " }, { email: "old@x.kz", full_name: "" },
  ] }), classContext);
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [{ table: "rpc", kind: "add_web_class_members", payload: { p_class_id: "c1", p_students: [
    { email: "old@x.kz", full_name: null }, { email: "new@x.kz", full_name: "Ахметов Нурлан" },
  ] } }]);
});

test("a failed save reports an error and an invalid list sends nothing", async () => {
  let writes = setup((table) => activeClass(table) ?? { data: null, error: { message: "down" } });
  assert.equal((await POST(body({ emails: ["a@x.kz"] }), classContext)).status, 503);
  writes = setup((table) => activeClass(table) ?? { data: 1, error: null });
  assert.equal((await POST(body({ students: [{ email: "bad" }] }), classContext)).status, 400);
  assert.equal(writes.length, 0);
});

test("the older emails-only request still works", async () => {
  const writes = setup((table) => activeClass(table) ?? { data: 1, error: null });
  assert.equal((await POST(body({ emails: ["A@x.kz"] }), classContext)).status, 200);
  assert.deepEqual(writes[0].payload.p_students, [{ email: "a@x.kz", full_name: null }]);
});

test("renaming needs the full_name field; null or empty clears it", async () => {
  for (const bad of [null, [], {}, { name: "Анна" }]) {
    const writes = setup((table) => activeClass(table) ?? { data: { id: "m1" }, error: null });
    const response = await PATCH(body(bad), memberContext);
    assert.equal(response.status, 400, JSON.stringify(bad));
    assert.equal(writes.length, 0);
  }
  for (const [value, stored] of [["  Жанов   Жан ", "Жанов Жан"], ["", null], [null, null]]) {
    const writes = setup((table) => activeClass(table) ?? { data: { id: "m1" }, error: null });
    const response = await PATCH(body({ full_name: value }), memberContext);
    assert.equal(response.status, 200);
    assert.deepEqual(writes.map(write => write.payload), [{ full_name: stored }]);
  }
  const writes = setup((table) => activeClass(table) ?? { data: { id: "m1" }, error: null });
  assert.equal((await PATCH(body({ full_name: "123" }), memberContext)).status, 400);
  assert.equal(writes.length, 0);
});

test("students only and archived or foreign classes cannot rename", async () => {
  setup(() => ({ data: null, error: null }));
  assert.equal((await PATCH(body({ full_name: "Анна" }), memberContext)).status, 404);
  globalThis.rosterMocks.actor = { id: "s1", role: "student", accessToken: "t" };
  assert.equal((await PATCH(body({ full_name: "Анна" }), memberContext)).status, 401);
  assert.equal((await POST(body({ emails: ["a@x.kz"] }), classContext)).status, 401);
});
