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
  assert.match(route, /limit\(100\)/);
  assert.doesNotMatch(route, /console\.log\([^)]*answers/);
});

test("Supabase scheduler keeps endpoint credentials in Vault and runs once per minute", () => {
  assert.match(cron, /vault\.decrypted_secrets/);
  assert.match(cron, /ai_teacher_finalizer_secret/);
  assert.match(cron, /'\* \* \* \* \*'/);
  assert.match(cron, /net\.http_post/);
});
