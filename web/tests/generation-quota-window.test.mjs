import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase_generation_quota_window_refund.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/generate/route.ts", import.meta.url), "utf8");
const legacyMigration = readFileSync(new URL("../supabase_launch_hardening.sql", import.meta.url), "utf8");

test("forward-only quota RPCs reserve and return the exact hourly window", () => {
  assert.match(migration, /create or replace function public\.consume_web_generation_quota_v2\(\)\s*returns timestamptz/i);
  assert.match(migration, /on conflict \(owner_id, window_start\) do update[\s\S]*?attempt_count\s*<\s*5[\s\S]*?returning window_start into reserved_window/i);
  assert.match(migration, /grant execute on function public\.consume_web_generation_quota_v2\(\) to authenticated/i);
  assert.doesNotMatch(migration, /drop function public\.(consume|release)_web_generation_quota\(/i);
  assert.match(legacyMigration, /create or replace function public\.consume_web_generation_quota\(\)/i);
});

test("refund locks and changes only the DB-returned reservation window", () => {
  const release = migration.match(/create or replace function public\.release_web_generation_quota_v2\(p_owner_id uuid, p_window_start timestamptz\)[\s\S]*?\$\$;/i)?.[0];
  assert.ok(release);
  assert.match(release, /auth\.role\(\)[\s\S]*service_role/i);
  assert.match(release, /where owner_id = p_owner_id and window_start = p_window_start\s*for update/i);
  assert.equal((release.match(/where owner_id = p_owner_id and window_start = p_window_start/g) || []).length, 3);
  assert.doesNotMatch(release, /date_trunc\s*\(|current_window|window_start\s*=\s*now\(\)/i);
  assert.match(migration, /revoke all on function public\.release_web_generation_quota_v2\(uuid, timestamptz\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.release_web_generation_quota_v2\(uuid, timestamptz\) to service_role/i);
});

test("generation fails closed without a reservation and refunds on both failure paths", () => {
  assert.match(route, /db\.rpc\("consume_web_generation_quota_v2"\)/);
  assert.match(route, /if \(error \|\| \(data !== null && typeof data !== "string"\)\)/);
  assert.match(route, /reservationWindow = data/);
  assert.match(route, /if \(reservationWindow === null\) return jsonError\([\s\S]*?, 429\)/);
  assert.match(route, /adminClient\(\)\.rpc\("release_web_generation_quota_v2",\s*\{\s*p_owner_id: actor\.id, p_window_start: reservationWindow/);
  assert.equal((route.match(/await releaseQuota\(\)/g) || []).length, 2);
});
