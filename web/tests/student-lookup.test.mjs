import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Fake Supabase: profiles from the table, users from the Auth admin API.
const modules = new Map([
  ["server-only", "export {};"],
  ["./supabase-admin", "export const adminClient = () => globalThis.lookupMocks.admin;"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { studentIdentities } = await import("../lib/student-lookup.ts");

function fakeAdmin({ users, failAuth = false }) {
  const calls = { byId: 0, list: 0 };
  const admin = {
    from: () => ({ select: () => ({ in: async (_column, ids) => ({ data: ids.map(id => ({ id, display_name: `Name ${id}` })), error: null }) }) }),
    auth: { admin: {
      getUserById: async (id) => {
        calls.byId++;
        if (failAuth) return { data: { user: null }, error: { status: 500 } };
        const user = users.find(item => item.id === id);
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { status: 404 } };
      },
      listUsers: async ({ page, perPage }) => { calls.list++; return failAuth ? { data: { users: [] }, error: { status: 500 } } : { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }; },
    } },
  };
  globalThis.lookupMocks = { admin };
  return calls;
}
const many = (count) => Array.from({ length: count }, (_, i) => ({ id: `s${i}`, email: `s${i}@school.kz` }));

test("a few students are looked up one by one, with name and email", async () => {
  const calls = fakeAdmin({ users: many(3) });
  const result = await studentIdentities(["s0", "s1", "s1"]);
  assert.deepEqual(result.get("s1"), { name: "Name s1", email: "s1@school.kz" });
  assert.equal(calls.byId, 2);
  assert.equal(calls.list, 0);
});

test("a large export reads the user list in pages instead of one call per student", async () => {
  const users = many(2500);
  const calls = fakeAdmin({ users });
  const result = await studentIdentities(users.map(user => user.id));
  assert.equal(result.get("s2499").email, "s2499@school.kz");
  assert.equal(calls.byId, 0);
  assert.equal(calls.list, 3);
});

test("an Auth failure is reported instead of silently dropping emails", async () => {
  fakeAdmin({ users: many(3), failAuth: true });
  assert.equal(await studentIdentities(["s0"]), null);
  fakeAdmin({ users: many(60), failAuth: true });
  assert.equal(await studentIdentities(many(60).map(user => user.id)), null);
});

test("a user list larger than the scan covers is reported, not cut short", async () => {
  const users = many(101 * 1000 + 1);
  fakeAdmin({ users });
  assert.equal(await studentIdentities(["s0", ...users.slice(-60).map(user => user.id)]), null);
});

test("students found early stop the scan; a deleted account simply has no email", async () => {
  const users = many(5000);
  const calls = fakeAdmin({ users });
  const ids = [...users.slice(0, 60).map(user => user.id)];
  const result = await studentIdentities(ids);
  assert.equal(calls.list, 1);
  assert.equal(result.get("s59").email, "s59@school.kz");
});

test("a deleted account keeps the results page working, just without an email", async () => {
  fakeAdmin({ users: many(1) });
  const result = await studentIdentities(["s0", "gone"]);
  assert.equal(result.get("s0").email, "s0@school.kz");
  assert.deepEqual(result.get("gone"), { name: "Name gone", email: null });
});
