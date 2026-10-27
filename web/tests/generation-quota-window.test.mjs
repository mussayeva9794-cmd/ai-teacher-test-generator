import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseGenerationWindow, reserveGenerationWindow } from "../lib/generation-quota.ts";

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
  assert.match(route, /const reservation = await reserveGenerationWindow\(db\)/);
  assert.match(route, /if \(reservation\.status !== "allowed"\)[\s\S]*?429\)[\s\S]*?503\)/);
  assert.match(route, /releaseGenerationWindow\(adminClient\(\), actor\.id, window\)/);
  assert.equal((route.match(/await releaseQuota\(\)/g) || []).length, 2);
});

test("the reservation helper returns only the DB-issued window and fails closed", async () => {
  const calls = [];
  const ok = { rpc: async (...args) => { calls.push(args); return { data: "2026-10-27T10:00:00+00:00", error: null }; } };
  assert.deepEqual(await reserveGenerationWindow(ok), { status: "allowed", window: "2026-10-27T10:00:00+00:00" });
  assert.deepEqual(calls, [["consume_web_generation_quota_v2"]]);
  assert.deepEqual(await reserveGenerationWindow({ rpc: async () => ({ data: null, error: null }) }), { status: "limited" });
  assert.deepEqual(await reserveGenerationWindow({ rpc: async () => ({ data: true, error: null }) }), { status: "unavailable" });
  assert.deepEqual(await reserveGenerationWindow({ rpc: async () => ({ data: null, error: { code: "42883" } }) }), { status: "unavailable" });
  assert.deepEqual(await reserveGenerationWindow({ rpc: async () => { throw new Error("network"); } }), { status: "unavailable" });

  const released = [];
  await releaseGenerationWindow({ rpc: async (...args) => { released.push(args); return { error: null }; } }, "teacher-id", "w1");
  assert.deepEqual(released, [["release_web_generation_quota_v2", { p_owner_id: "teacher-id", p_window_start: "w1" }]]);
});
