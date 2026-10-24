import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const route = readFileSync(fileURLToPath(new URL("../app/api/internal/finalize-expired-drafts/route.ts", import.meta.url)), "utf8");
const cron = readFileSync(fileURLToPath(new URL("../supabase_expired_draft_finalizer.sql", import.meta.url)), "utf8");

test("expired-draft finalizer is protected and delegates the final decision to the atomic RPC", () => {
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /attemptWindowExpired/);
  assert.match(route, /rpc\("finalize_web_attempt"/);
  assert.doesNotMatch(route, /console\.log\([^)]*answers/);
});

test("expired-draft finalizer pages through every draft instead of a fixed oldest-N window", () => {
  // Untimed or archived-test drafts never leave the table; a fixed window would starve timed drafts.
  assert.doesNotMatch(route, /\.limit\(100\)/);
  assert.match(route, /\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
  assert.match(route, /order\("started_at", \{ ascending: true \}\)\.order\("link_id"[^)]*\)\.order\("student_id"/);
  assert.match(route, /scanned < MAX_SCANNED && Date\.now\(\) - began < TIME_BUDGET_MS/);
  assert.match(route, /offset \+= PAGE_SIZE - removed/);
  assert.match(route, /if \(page\.length < PAGE_SIZE\) break;/);
  assert.ok(Number(route.match(/TIME_BUDGET_MS = ([\d_]+)/)[1].replace(/_/g, "")) < 60_000, "budget must fit maxDuration");
});

test("expired-draft finalizer batches link lookups and caches tests per run", () => {
  assert.match(route, /from\("web_share_links"\)\.select\(LINK_COLUMNS\)\.in\("id", unknownLinkIds\)/);
  assert.match(route, /tests\.has\(typedLink\.test_id\)/);
  assert.doesNotMatch(route, /from\("web_share_links"\)[^;]*\.eq\("id", draft\.link_id\)/);
});

test("Supabase scheduler keeps endpoint credentials in Vault and runs once per minute", () => {
  assert.match(cron, /vault\.decrypted_secrets/);
  assert.match(cron, /ai_teacher_finalizer_secret/);
  assert.match(cron, /'\* \* \* \* \*'/);
  assert.match(cron, /net\.http_post/);
});
