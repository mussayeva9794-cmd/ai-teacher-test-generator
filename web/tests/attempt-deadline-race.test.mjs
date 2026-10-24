import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => ({ id: 'student-1', role: 'student' }); export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/share", "export const shareContext = async () => globalThis.deadlineMocks.context;"],
  ["@/lib/assessment", "export const personalizedVariant = variant => variant; export const studentVariant = variant => variant; export const grade = (_variant, answers) => { if (globalThis.deadlineMocks.expireDuringGrade) globalThis.deadlineMocks.expired = true; return { percentage: answers.q1 === 'saved' ? 100 : 0 }; };"],
  ["@/lib/attempt-window", "export const attemptWindowExpired = () => false;"],
  // These fixtures use non-strict links; strict-mode rules have their own tests.
  ["@/lib/integrity-server", "export const loadIntegrity = async () => null; export const leaveLimitReached = () => false; export const enforceQuestionWindows = next => next;"],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { PUT } = await import("../app/api/share/[token]/draft/route.ts");
const { POST } = await import("../app/api/share/[token]/submit/route.ts");
const { GET } = await import("../app/api/share/[token]/route.ts");
const params = { params: Promise.resolve({ token: "share-token" }) };

function setup() {
  const writes = [];
  const draft = { started_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:01:00Z", answers: { q1: "saved" } };
  const admin = {
    from(table) {
      return {
        select() {
          return {
            eq() { return this; },
            maybeSingle: async () => ({ data: table === "web_drafts" ? draft : null, error: null }),
          };
        },
        delete() { return { eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
      };
    },
    async rpc(name, args) {
      writes.push({ table: "rpc", name, args });
      return globalThis.deadlineMocks.rpc(name, args);
    },
  };
  globalThis.deadlineMocks = {
    expired: false,
    draft,
    rpc(name, args) {
      if (name === "save_web_draft_if_open") {
        return Promise.resolve({ data: globalThis.deadlineMocks.expired ? "expired" : "saved", error: null });
      }
      return Promise.resolve({
        data: {
          status: "submitted",
          expired: globalThis.deadlineMocks.expired,
          percentage: globalThis.deadlineMocks.expired ? args.p_saved_percentage : args.p_current_percentage,
        },
        error: null,
      });
    },
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
  assert.equal(writes.filter(write => write.name === "save_web_draft_if_open").length, 1);
  assert.equal(writes.some(write => write.table === "web_drafts" && write.payload), false);
});

test("a slow submission uses only the saved draft after the deadline", async () => {
  const writes = setup();
  const request = { json: async () => { globalThis.deadlineMocks.expired = true; return { answers: { q1: "late" } }; } };
  const response = await POST(request, params);
  assert.equal(response.status, 200);
  const submission = writes.find(write => write.name === "finalize_web_attempt");
  assert.deepEqual(submission.args.p_current_answers, { q1: "late" });
  assert.deepEqual(submission.args.p_saved_answers, { q1: "saved" });
  assert.equal(submission.args.p_saved_percentage, 100);
  assert.equal((await response.json()).expired, true);
});

test("submission crossing the deadline while grading falls back to saved answers", async () => {
  const writes = setup();
  globalThis.deadlineMocks.expireDuringGrade = true;
  const response = await POST({ json: async () => ({ answers: { q1: "late" } }) }, params);
  assert.equal(response.status, 200);
  const submission = writes.find(write => write.name === "finalize_web_attempt");
  assert.deepEqual(submission.args.p_saved_answers, { q1: "saved" });
  assert.equal(submission.args.p_saved_percentage, 100);
});

test("draft saving delegates the deadline decision and write to one database RPC", async () => {
  const writes = setup();
  const response = await PUT({ json: async () => ({ answers: { q1: "current" } }) }, params);
  assert.equal(response.status, 200);
  const save = writes.find(write => write.name === "save_web_draft_if_open");
  assert.deepEqual(save.args, {
    p_link_id: "link-1", p_test_id: "test-1", p_student_id: "student-1", p_answers: { q1: "current" },
  });
  assert.equal(writes.some(write => write.table === "web_drafts" && write.payload), false);
});

test("finalization reloads and regrades when an autosave wins the draft lock", async () => {
  const writes = setup();
  let attempt = 0;
  globalThis.deadlineMocks.rpc = async (name) => {
    if (name === "finalize_web_attempt" && attempt++ === 0) {
      globalThis.deadlineMocks.draft.answers = { q1: "newly-saved" };
      globalThis.deadlineMocks.draft.updated_at = "2026-10-08T10:02:00Z";
      return { data: { status: "draft_changed" }, error: null };
    }
    return {
      data: { status: "submitted", expired: true, percentage: 0 }, error: null,
    };
  };
  const response = await POST({ json: async () => ({ answers: { q1: "late" } }) }, params);
  assert.equal(response.status, 200);
  const finalizations = writes.filter(write => write.name === "finalize_web_attempt");
  assert.equal(finalizations.length, 2);
  assert.equal(finalizations[1].args.p_expected_draft_updated_at, "2026-10-08T10:02:00Z");
  assert.deepEqual(finalizations[1].args.p_saved_answers, { q1: "newly-saved" });
});

test("first open delegates draft creation and deadline enforcement to one RPC", async () => {
  const writes = [];
  const startedDraft = { started_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:00:00Z", answers: {} };
  let draft = null;
  const admin = {
    from(table) {
      const query = {
        eq() { return this; },
        maybeSingle: async () => ({ data: table === "web_drafts" ? draft : null, error: null }),
        single: async () => ({ data: draft, error: null }),
      };
      return {
        select() { return query; },
        insert(payload) { writes.push({ kind: "insert", payload }); return Promise.resolve({ error: null }); },
      };
    },
    async rpc(name, args) {
      writes.push({ kind: "rpc", name, args });
      if (name === "start_web_draft_if_open") draft = startedDraft;
      return { data: "started", error: null };
    },
  };
  globalThis.deadlineMocks.context = {
    admin, link: { id: "link-1", variant_name: "A" }, test: { id: "test-1", title: "Test", topic: "Topic" },
    settings: { deadline_at: null, timer_minutes: 0, randomize: false, reveal_score: false },
    variant: { questions: [{ id: "q1" }] },
  };

  const response = await GET({}, params);
  assert.equal(response.status, 200);
  assert.equal(writes.filter((write) => write.name === "start_web_draft_if_open").length, 1);
  assert.equal(writes.some((write) => write.kind === "insert"), false);
});

test("first open returns the cutoff error when the atomic start RPC says expired", async () => {
  const writes = [];
  const admin = {
    from() {
      const query = { eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) };
      return { select() { return query; }, insert() { writes.push("insert"); return Promise.resolve({ error: null }); } };
    },
    async rpc(name) { writes.push(name); return { data: "expired", error: null }; },
  };
  globalThis.deadlineMocks.context = {
    admin, link: { id: "link-1", variant_name: "A" }, test: { id: "test-1", title: "Test", topic: "Topic" },
    settings: { deadline_at: "2000-01-01T00:00:00Z", timer_minutes: 0, randomize: false, reveal_score: false },
    variant: { questions: [{ id: "q1" }] },
  };

  const response = await GET({}, params);
  assert.equal(response.status, 403);
  assert.deepEqual(writes, ["start_web_draft_if_open"]);
});
