import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Drives the real submit route with a strict link. Found live: a locked attempt
// sent no current answers, and finalize_web_attempt rejects that while the
// attempt window is open ("Invalid answers.").
const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => ({ id: 'student-1', role: 'student' }); export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/share", "export const shareContext = async () => globalThis.strictMocks.context;"],
  ["@/lib/assessment", "export const personalizedVariant = variant => variant; export const grade = (_variant, answers) => ({ percentage: answers.q1 === 'saved' ? 100 : 0 });"],
  ["@/lib/integrity-server", `
    export const loadIntegrity = async () => globalThis.strictMocks.integrity;
    export const leaveLimitReached = (settings, leaves) => settings.strict_mode && settings.leave_limit !== null && leaves > settings.leave_limit;
    export const enforceQuestionWindows = next => next;`],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/share/[token]/submit/route.ts");
const params = { params: Promise.resolve({ token: "share-token" }) };

function setup({ leaves, body }) {
  const calls = [];
  const admin = {
    from(table) {
      return {
        select() {
          return {
            eq() { return this; },
            maybeSingle: async () => ({
              data: table === "web_drafts" ? { answers: { q1: "saved" }, updated_at: "2026-10-24T10:00:00Z" } : null, error: null,
            }),
          };
        },
        delete() { return { eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
        insert: async (row) => { calls.push({ insert: table, row }); return { error: null }; },
      };
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      // Mirrors finalize_web_attempt while the window is open.
      if (!args.p_current_answers || typeof args.p_current_answers !== "object") return { data: { status: "invalid_answers" }, error: null };
      return { data: { status: "submitted", expired: false, percentage: args.p_current_percentage }, error: null };
    },
  };
  globalThis.strictMocks = {
    integrity: { events: leaves, leaves, pastes: 0, copies: 0, question_started: {} },
    context: {
      admin, link: { id: "link-1" }, test: { id: "test-1" }, variant: { questions: [{ id: "q1" }] },
      settings: { strict_mode: true, leave_limit: 1, question_seconds: 0, randomize: false, reveal_score: true },
    },
  };
  return { calls, request: { json: async () => body } };
}

test("a locked strict attempt submits the saved draft, ignores new answers and records auto-submit", async () => {
  const { calls, request } = setup({ leaves: 2, body: { answers: { q1: "answer from AI" } } });
  const response = await POST(request, params);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.locked, true);
  assert.equal(payload.percentage, 100);
  const finalize = calls.find(call => call.rpc === "finalize_web_attempt");
  assert.deepEqual(finalize.args.p_current_answers, { q1: "saved" });
  assert.ok(calls.some(call => call.insert === "web_attempt_events" && call.row.kind === "auto_submit"));
});

test("a strict attempt submitted without answers (last question timed out) uses the saved draft", async () => {
  const { calls, request } = setup({ leaves: 0, body: {} });
  const response = await POST(request, params);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(call => call.rpc === "finalize_web_attempt").args.p_current_answers, { q1: "saved" });
  assert.equal(calls.some(call => call.insert === "web_attempt_events"), false);
});

test("an unlocked strict attempt still submits the student's current answers", async () => {
  const { calls, request } = setup({ leaves: 1, body: { answers: { q1: "fresh" } } });
  const response = await POST(request, params);
  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(call => call.rpc === "finalize_web_attempt").args.p_current_answers, { q1: "fresh" });
});
