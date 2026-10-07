import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDestination, signupOptions } from "../lib/signup.ts";
import { releaseGenerationQuota, reserveGeneration } from "../lib/generation-quota.ts";

const migration = readFileSync(fileURLToPath(new URL("../supabase_launch_hardening.sql", import.meta.url)), "utf8");
const baseSchema = readFileSync(fileURLToPath(new URL("../supabase_v2.sql", import.meta.url)), "utf8");
const generateRoute = readFileSync(fileURLToPath(new URL("../app/api/generate/route.ts", import.meta.url)), "utf8");
const backupScript = fileURLToPath(new URL("../scripts/backup-supabase.sh", import.meta.url));
const healthWorkflow = readFileSync(fileURLToPath(new URL("../../.github/workflows/production-health.yml", import.meta.url)), "utf8");

test("public sign-up never requests a teacher role", () => {
  const options = signupOptions("  Mira  ", "https://school.example", "/s/abc");
  assert.deepEqual(options.data, { display_name: "Mira" });
  assert.equal(options.emailRedirectTo, "https://school.example/login?next=%2Fs%2Fabc");
});

test("post-login destination uses the stored profile role", () => {
  assert.equal(defaultDestination("teacher"), "/dashboard");
  assert.equal(defaultDestination("student"), "/");
  assert.equal(defaultDestination(undefined), "/");
});

test("generation quota allows a reserved request", async () => {
  const result = await reserveGeneration({ rpc: async () => ({ data: true, error: null }) });
  assert.equal(result, "allowed");
});

test("generation quota denies exhausted requests and fails closed on database errors", async () => {
  assert.equal(await reserveGeneration({ rpc: async () => ({ data: false, error: null }) }), "limited");
  assert.equal(await reserveGeneration({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }), "unavailable");
  assert.equal(await reserveGeneration({ rpc: async () => { throw new Error("network unavailable"); } }), "unavailable");
});

test("role migration ignores self-reported roles and only grants student on signup", () => {
  assert.match(migration, /create or replace function public\.create_web_profile\(\)/i);
  assert.match(migration, /on conflict \(id\) do nothing/i);
  assert.match(migration, /'student'\s*\)/i);
  assert.doesNotMatch(migration, /raw_user_meta_data\s*->>\s*'role'/i);
  assert.doesNotMatch(baseSchema, /raw_user_meta_data\s*->>\s*'role'/i);
});

test("generation quota is enforced inside the database with a fixed cap", () => {
  assert.match(migration, /create or replace function public\.consume_web_generation_quota\(\)/i);
  assert.match(migration, /attempt_count\s*<\s*5/i);
  assert.match(migration, /grant execute on function public\.consume_web_generation_quota\(\) to authenticated/i);
  assert.ok(generateRoute.indexOf("await reserveGeneration(db)") < generateRoute.indexOf("await generateVariants("));
});

test("generation failures release reserved quota and health checks require the configured model", () => {
  const releaseFunction = migration.match(/create or replace function public\.release_web_generation_quota\(p_owner_id uuid\)[\s\S]*?\$\$;/i)?.[0] || "";
  assert.ok(releaseFunction);
  assert.match(migration, /drop function if exists public\.release_web_generation_quota\(\)/i);
  assert.match(releaseFunction, /auth\.role\(\)[\s\S]*service_role/i);
  assert.match(releaseFunction, /for update/i);
  assert.match(releaseFunction, /if reserved_count = 1 then[\s\S]*delete from public\.web_generation_quota[\s\S]*elsif reserved_count > 1 then[\s\S]*attempt_count = attempt_count - 1/i);
  assert.doesNotMatch(releaseFunction, /attempt_count = attempt_count - 1[\s\S]*delete from public\.web_generation_quota/i);
  assert.match(migration, /revoke all on function public\.release_web_generation_quota\(uuid\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.release_web_generation_quota\(uuid\) to service_role/i);
  assert.match(generateRoute, /releaseGenerationQuota\(adminClient\(\), actor\.id\)/);
  assert.match(readFileSync(fileURLToPath(new URL("../lib/supabase-admin.ts", import.meta.url)), "utf8"), /^import "server-only";/);
  assert.equal((generateRoute.match(/await releaseQuota\(\)/g) || []).length, 2);
  assert.match(healthWorkflow, /\.groq_model_available == true/);
});

test("quota rollback RPC receives the server-selected owner and reports failures", async () => {
  const calls = [];
  const db = { rpc: async (...args) => { calls.push(args); return { error: null }; } };
  assert.equal(await releaseGenerationQuota(db, "teacher-id"), "released");
  assert.deepEqual(calls, [["release_web_generation_quota", { p_owner_id: "teacher-id" }]]);
  assert.equal(await releaseGenerationQuota({ rpc: async () => ({ error: { code: "42501" } }) }, "teacher-id"), "failed");
  assert.equal(await releaseGenerationQuota({ rpc: async () => { throw new Error("network error"); } }, "teacher-id"), "failed");
});

test("backup is published only after every dump and its checksum succeed", () => {
  const scratch = mkdtempSync(join(tmpdir(), "ai-teacher-backup-test-"));
  const mock = join(scratch, "supabase");
  writeFileSync(mock, `#!/bin/sh
out=""
data_only=0
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-f" ]; then shift; out="$1"; fi
  if [ "$1" = "--data-only" ]; then data_only=1; fi
  shift
done
if [ "${"$"}MOCK_FAIL" = "1" ] && [ "$data_only" = "1" ]; then exit 2; fi
printf 'test dump\\n' > "$out"
`);
  chmodSync(mock, 0o700);
  const env = { ...process.env, PATH: `${scratch}:${process.env.PATH}`, SUPABASE_DB_URL: "postgres://mock", MOCK_FAIL: "" };
  try {
    const goodRoot = join(scratch, "good");
    const good = spawnSync("bash", [backupScript, goodRoot], { env, encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    const entries = readdirSync(goodRoot);
    assert.equal(entries.length, 1);
    assert.ok(!entries[0].startsWith(".incomplete-"));
    const check = spawnSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], {
      cwd: join(goodRoot, entries[0]), encoding: "utf8",
    });
    assert.equal(check.status, 0, check.stderr);

    const badRoot = join(scratch, "bad");
    const bad = spawnSync("bash", [backupScript, badRoot], {
      env: { ...env, MOCK_FAIL: "1" }, encoding: "utf8",
    });
    assert.notEqual(bad.status, 0);
    assert.ok(readdirSync(badRoot).every(name => name.startsWith(".incomplete-")));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
