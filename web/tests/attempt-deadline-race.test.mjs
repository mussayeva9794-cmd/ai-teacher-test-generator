import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => ({ id: 'student-1', role: 'student' }); export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/share", "export const shareContext = async () => globalThis.deadlineMocks.context;"],
  ["@/lib/attempt-window", "export const attemptWindowExpired = () => globalThis.deadlineMocks.expired; export const canStartAttempt = () => !globalThis.deadlineMocks.expired;"],
  ["@/lib/assessment", "export const personalizedVariant = variant => variant; export const grade = (_variant, answers) => { if (globalThis.deadlineMocks.expireDuringGrade) globalThis.deadlineMocks.expired = true; return { percentage: answers.q1 === 'saved' ? 100 : 0 }; };"],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { PUT } = await import("../app/api/share/[token]/draft/route.ts");
const { POST } = await import("../app/api/share/[token]/submit/route.ts");
const params = { params: Promise.resolve({ token: "share-token" }) };

function setup() {
  const writes = [];
  const draft = { started_at: "2026-10-08T10:00:00Z", answers: { q1: "saved" } };
  const admin = {
    from(table) {
      return {
        select() {
          return {
            eq() { return this; },
            maybeSingle: async () => ({ data: table === "web_drafts" ? draft : null, error: null }),
          };
        },
        update(payload) { writes.push({ table, payload }); return { eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
        insert(payload) { writes.push({ table, payload }); return Promise.resolve({ error: null }); },
        delete() { return { eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
      };
    },
  };
  globalThis.deadlineMocks = {
    expired: false,
    context: {
      admin, link: { id: "link-1", variant_name: "A" }, test: { id: "test-1" },
      settings: { deadline_at: null, timer_minutes: 10, randomize: false, reveal_score: true },
      variant: { questions: [{ id: "q1" }] },
    },
  };
  return writes;
}

test("a slow draft upload cannot save answers after the deadline", async () => {
  const writes = setup();
  const request = { json: async () => { globalThis.deadlineMocks.expired = true; return { answers: { q1: "late" } }; } };
  const response = await PUT(request, params);
  assert.equal(response.status, 403);
  assert.equal(writes.length, 0);
});

test("a slow submission uses only the saved draft after the deadline", async () => {
  const writes = setup();
  const request = { json: async () => { globalThis.deadlineMocks.expired = true; return { answers: { q1: "late" } }; } };
  const response = await POST(request, params);
  assert.equal(response.status, 200);
  const submission = writes.find(write => write.table === "web_attempts");
  assert.deepEqual(submission.payload.answers, { q1: "saved" });
  assert.equal(submission.payload.percentage, 100);
});

test("submission crossing the deadline while grading falls back to saved answers", async () => {
  const writes = setup();
  globalThis.deadlineMocks.expireDuringGrade = true;
  const response = await POST({ json: async () => ({ answers: { q1: "late" } }) }, params);
  assert.equal(response.status, 200);
  const submission = writes.find(write => write.table === "web_attempts");
  assert.deepEqual(submission.payload.answers, { q1: "saved" });
  assert.equal(submission.payload.percentage, 100);
});
