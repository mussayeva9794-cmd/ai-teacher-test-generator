import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// lib modules import siblings without an extension (bundler style); resolve
// those to the .ts files so the real modules run under node --test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.\w+$/.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { finalizeLockedAttempt } = await import("../lib/strict-finalize.ts");
const { parseSettings } = await import("../lib/assessment.ts");

function lockedAdmin(draft) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        select() { return { eq() { return this; }, maybeSingle: async () => ({ data: table === "web_drafts" ? draft : null, error: null }) }; },
        delete() { calls.push({ delete: table }); return { eq() { return this; }, then(resolve) { resolve({ error: null }); } }; },
        insert: async (row) => { calls.push({ insert: table, row }); return { error: null }; },
      };
    },
    async rpc(name, args) { calls.push({ rpc: name, args }); return { data: { status: "submitted" }, error: null }; },
  };
}
const lockedArgs = {
  linkId: "link-1", testId: "test-1", studentId: "student-1", token: "tok",
  variant: { title: "T", instructions: "", questions: [{ id: "q1", type: "multiple_choice", question: "?", options: ["a", "b"], correct_answer: "a", explanation: "", skill_tag: "" }] },
  settings: parseSettings({ strict_mode: true, randomize: false }),
};

test("the server submits a locked attempt from its saved draft without the student returning", async () => {
  const admin = lockedAdmin({ answers: { q1: "a", injected: "x" }, updated_at: "2026-10-24T10:00:00Z" });
  assert.equal(await finalizeLockedAttempt(admin, lockedArgs), "submitted");
  const finalize = admin.calls.find(call => call.rpc === "finalize_web_attempt");
  assert.deepEqual(finalize.args.p_current_answers, { q1: "a" });
  assert.equal(finalize.args.p_current_percentage, 100);
  assert.ok(admin.calls.some(call => call.delete === "web_drafts"));
  assert.ok(admin.calls.some(call => call.insert === "web_attempt_events" && call.row.kind === "auto_submit"));
  assert.equal(await finalizeLockedAttempt(lockedAdmin(null), lockedArgs), "no_draft");
});

