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
const attemptConstraint = readFileSync(fileURLToPath(new URL("../supabase_attempts_unique_constraint.sql", import.meta.url)), "utf8");
const productionAudit = readFileSync(fileURLToPath(new URL("../supabase_school_production_audit.sql", import.meta.url)), "utf8");
const manualReviewMigration = readFileSync(fileURLToPath(new URL("../supabase_manual_review.sql", import.meta.url)), "utf8");
const summaryMigration = readFileSync(fileURLToPath(new URL("../supabase_results_summary.sql", import.meta.url)), "utf8");
const baseSchema = readFileSync(fileURLToPath(new URL("../supabase_v2.sql", import.meta.url)), "utf8");
const generateRoute = readFileSync(fileURLToPath(new URL("../app/api/generate/route.ts", import.meta.url)), "utf8");
const groqClient = readFileSync(fileURLToPath(new URL("../lib/groq.ts", import.meta.url)), "utf8");
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

test("Groq GPT-OSS requests suppress reasoning with the supported parameter", () => {
  assert.match(groqClient, /include_reasoning:\s*false/);
  assert.doesNotMatch(groqClient, /reasoning_format/);
});

test("Groq failures log only safe status metadata and hide server configuration from teachers", () => {
  assert.match(groqClient, /public readonly upstreamStatus\?: number/);
  assert.match(generateRoute, /upstreamStatus:\s*error instanceof GroqGenerationError \? error\.upstreamStatus : undefined/);
  assert.doesNotMatch(generateRoute, /Replace GROQ_API_KEY/);
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

test("school migrations preserve attempt rows, add one-attempt enforcement, and keep summaries under RLS", () => {
  assert.match(productionAudit, /^--[\s\S]*?select/i);
  assert.match(productionAudit, /having count\(\*\) > 1/i);
  assert.doesNotMatch(productionAudit.replace(/^--.*$/gm, ""), /\b(insert|update|delete|truncate|alter|drop)\s+(into|table|public)\b/i);
  assert.match(attemptConstraint, /lock table public\.web_attempts in access exclusive mode/i);
  assert.match(attemptConstraint, /having count\(\*\) > 1/i);
  assert.match(attemptConstraint, /unique\s*\(test_id, student_id\)/i);
  assert.doesNotMatch(attemptConstraint, /delete\s+from\s+public\.web_attempts/i);
  assert.match(manualReviewMigration, /alter column percentage drop not null/i);
  assert.match(summaryMigration, /security invoker/i);
  assert.match(summaryMigration, /grant execute on function public\.web_test_attempt_summary\(uuid\) to authenticated/i);
});

test("generation quota is enforced inside the database with a fixed cap", () => {
  assert.match(migration, /create or replace function public\.consume_web_generation_quota\(\)/i);
  assert.match(migration, /attempt_count\s*<\s*5/i);
  assert.match(migration, /grant execute on function public\.consume_web_generation_quota\(\) to authenticated/i);
  assert.ok(generateRoute.indexOf('db.rpc("consume_web_generation_quota_v2")') < generateRoute.indexOf("await generateVariants("));
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
  assert.match(generateRoute, /adminClient\(\)\.rpc\("release_web_generation_quota_v2",\s*\{\s*p_owner_id: actor\.id, p_window_start: reservationWindow/);
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
  const mockDump = join(scratch, "pg_dump");
  const mockRestore = join(scratch, "pg_restore");
  writeFileSync(mockDump, `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--file" ]; then shift; out="$1"; fi
  shift
done
if [ "${"$"}MOCK_FAIL" = "1" ]; then exit 2; fi
printf 'test dump\\n' > "$out"
`);
  writeFileSync(mockRestore, "#!/bin/sh\nexit 0\n");
  chmodSync(mockDump, 0o700);
  chmodSync(mockRestore, 0o700);
  const env = { ...process.env, PATH: `${scratch}:${process.env.PATH}`, SUPABASE_DB_URL: "postgres://mock:mock@localhost:5432/postgres", MOCK_FAIL: "" };
  try {
    const goodRoot = join(scratch, "good");
    const good = spawnSync("bash", [backupScript, goodRoot], { env, encoding: "utf8" });
    assert.equal(good.status, 0, good.stderr);
    const entries = readdirSync(goodRoot);
    assert.equal(entries.length, 1);
    assert.ok(!entries[0].startsWith(".incomplete-"));
    assert.ok(readdirSync(join(goodRoot, entries[0])).includes("public.dump"));
    assert.ok(!readdirSync(join(goodRoot, entries[0])).includes(".pgpass"));
    const check = spawnSync("shasum", ["-a", "256", "-c", "SHA256SUMS"], {
      cwd: join(goodRoot, entries[0]), encoding: "utf8",
    });
    assert.equal(check.status, 0, check.stderr);

    const badRoot = join(scratch, "bad");
    const bad = spawnSync("bash", [backupScript, badRoot], {
      env: { ...env, MOCK_FAIL: "1" }, encoding: "utf8",
    });
    assert.notEqual(bad.status, 0);
    const incomplete = readdirSync(badRoot);
    assert.equal(incomplete.length, 1);
    assert.ok(incomplete[0].startsWith(".incomplete-"));
    assert.ok(!readdirSync(join(badRoot, incomplete[0])).includes(".pgpass"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
