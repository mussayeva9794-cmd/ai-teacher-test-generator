import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const modules = new Map([
  ["@/lib/auth", "export const actorFromRequest = async () => globalThis.reviewMocks.actor; export const jsonError = (message, status = 400) => Response.json({ error: message }, { status });"],
  ["@/lib/supabase", "export const userClient = () => globalThis.reviewMocks.userDb;"],
  ["@/lib/supabase-admin", "export const adminClient = () => globalThis.reviewMocks.adminDb;"],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(specifier))}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { PATCH } = await import("../app/api/tests/[id]/attempts/review/route.ts");

function setup({ pending = true } = {}) {
  const updates = [];
  const result = {
    requires_manual_review: pending,
    total_score: 1,
    total_questions: 2,
    per_question: [
      { id: "q1", skill_tag: "Algebra", score: 1, requires_manual_review: false },
      { id: "q2", skill_tag: "Writing", score: 0, requires_manual_review: true },
    ],
  };
  globalThis.reviewMocks = {
    actor: { id: "teacher-1", role: "teacher", accessToken: "token" },
    userDb: { from: () => ({ select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: { id: "test-1" }, error: null }) }) }) },
    adminDb: { from: () => ({
      select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: { id: "attempt-1", result }, error: null }) }),
      update: (payload) => {
        updates.push(payload);
        return { eq() { return this; }, then(resolve) { resolve({ error: null }); } };
      },
    }) },
  };
  return updates;
}

function request(percentage) {
  return { json: async () => ({ attempt_id: "attempt-1", percentage }) };
}

const context = { params: Promise.resolve({ id: "test-1" }) };

test("overall manual score leaves every question explicitly unscored", async () => {
  const updates = setup();
  const response = await PATCH(request(75), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reviewed: true, percentage: 75 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].percentage, 75);
  assert.equal(updates[0].result.total_score, null);
  assert.equal(updates[0].result.per_question_scoring, "unscored");
  assert.equal(updates[0].result.requires_manual_review, false);
  assert.equal(updates[0].result.manually_reviewed_by, "teacher-1");
  assert.deepEqual(updates[0].result.per_question.map(({ id, score, requires_manual_review }) => ({ id, score, requires_manual_review })), [
    { id: "q1", score: null, requires_manual_review: false },
    { id: "q2", score: null, requires_manual_review: false },
  ]);
});

test("review rejects invalid scores and non-pending attempts without writing", async () => {
  const updates = setup();
  assert.equal((await PATCH(request(101), context)).status, 400);
  assert.equal((await PATCH(request(Number.NaN), context)).status, 400);
  assert.equal(updates.length, 0);
  setup({ pending: false });
  assert.equal((await PATCH(request(75), context)).status, 409);
});

test("results UI labels legacy manually reviewed questions as unscored", () => {
  const page = readFileSync(fileURLToPath(new URL("../app/tests/[id]/page.tsx", import.meta.url)), "utf8");
  assert.match(page, /attempt\.result\?\.manually_reviewed_by[\s\S]*?return "Не оценено по вопросу"/);
});
