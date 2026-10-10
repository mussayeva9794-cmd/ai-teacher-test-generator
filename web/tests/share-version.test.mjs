import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isValidVariant } from "../lib/assessment.ts";
import { selectShareVariant } from "../lib/share-variant.ts";

const shareRoute = readFileSync(fileURLToPath(new URL("../app/api/tests/[id]/share/route.ts", import.meta.url)), "utf8");
const shareContext = readFileSync(fileURLToPath(new URL("../lib/share.ts", import.meta.url)), "utf8");
const baseSchema = readFileSync(fileURLToPath(new URL("../supabase_v2.sql", import.meta.url)), "utf8");
const launchMigration = readFileSync(fileURLToPath(new URL("../supabase_launch_hardening.sql", import.meta.url)), "utf8");

const original = {
  title: "Variant A",
  instructions: "Original instructions",
  questions: [{
    id: "q1", type: "multiple_choice", question: "Original question?",
    options: ["original", "other"], correct_answer: "original",
    explanation: "Original explanation", skill_tag: "topic",
  }],
};

test("share creation snapshots the selected published variant", () => {
  assert.match(shareRoute, /const variantSnapshot = test\.variants\?\.\[variantName\]/);
  assert.match(shareRoute, /variant_snapshot:\s*variantSnapshot/);
  assert.match(shareRoute, /if \(!isValidVariant\(variantSnapshot\)\)/);
});

test("share uses the immutable snapshot after the current variant changes", () => {
  const edited = {
    ...original,
    title: "Edited Variant A",
    questions: [{ ...original.questions[0], question: "Edited question?", correct_answer: "other" }],
  };

  assert.deepEqual(selectShareVariant(original, { A: edited }, "A", isValidVariant), original);
});

test("legacy links with a null snapshot fall back to their named current variant", () => {
  assert.deepEqual(selectShareVariant(null, { A: original }, "A", isValidVariant), original);
  assert.deepEqual(selectShareVariant(undefined, { A: original }, "A", isValidVariant), original);
});

test("a non-null invalid snapshot fails closed instead of grading against edited content", () => {
  assert.equal(selectShareVariant({ title: "broken" }, { A: original }, "A", isValidVariant), null);
});

test("student share context reads the snapshot for both open and submit consumers", () => {
  assert.match(shareContext, /select\("id,test_id,owner_id,class_id,variant_name,variant_snapshot,settings,is_active"\)/);
  assert.match(shareContext, /selectShareVariant\(link\.variant_snapshot, row\.variants, link\.variant_name, isValidVariant\)/);
});

test("both schema paths add a nullable snapshot column idempotently", () => {
  assert.match(baseSchema, /variant_snapshot jsonb/i);
  for (const schema of [baseSchema, launchMigration]) {
    assert.match(schema, /alter table public\.web_share_links\s+add column if not exists variant_snapshot jsonb/i);
  }
  assert.match(launchMigration, /Existing share links intentionally keep a NULL snapshot/i);
});
