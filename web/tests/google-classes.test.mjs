import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizedClassEmails, normalizedClassName } from "../lib/classes.ts";
import { verifiedGoogleIdentityEmail } from "../lib/google-identity.ts";
import { googleOAuthOptions } from "../lib/signup.ts";

const root = (path) => fileURLToPath(new URL(path, import.meta.url));
const login = readFileSync(root("../app/login/page.tsx"), "utf8");
const classApi = readFileSync(root("../app/api/classes/route.ts"), "utf8");
const shareApi = readFileSync(root("../app/api/tests/[id]/share/route.ts"), "utf8");
const shareAccess = readFileSync(root("../lib/share.ts"), "utf8");
const auth = readFileSync(root("../lib/auth.ts"), "utf8");
const compat = readFileSync(root("../lib/schema-compat.ts"), "utf8");
const migration = readFileSync(root("../supabase_google_classes.sql"), "utf8");
const baseSchema = readFileSync(root("../supabase_v2.sql"), "utf8");

test("class names are trimmed, whitespace-normalized, and length-limited", () => {
  assert.equal(normalizedClassName("  7   А "), "7 А");
  assert.equal(normalizedClassName(""), null);
  assert.equal(normalizedClassName("x".repeat(49)), null);
});

test("class rosters normalize and deduplicate emails, rejecting malformed or oversized lists", () => {
  assert.deepEqual(normalizedClassEmails([" A@School.kz ", "a@school.kz", "b@gmail.com"]), ["a@school.kz", "b@gmail.com"]);
  assert.equal(normalizedClassEmails(["not-an-email"]), null);
  assert.equal(normalizedClassEmails(Array(101).fill("a@school.kz")), null);
});

test("only the verified email from the Google identity can claim a class invitation", () => {
  assert.equal(verifiedGoogleIdentityEmail([
    { provider: "email", identity_data: { email: "child@school.kz", email_verified: true } },
    { provider: "google", identity_data: { email: " Child@School.kz ", email_verified: true } },
  ]), "child@school.kz");
  assert.equal(verifiedGoogleIdentityEmail([
    { provider: "google", identity_data: { email: "child@school.kz", email_verified: false } },
  ]), null);
  assert.equal(verifiedGoogleIdentityEmail([
    { provider: "email", identity_data: { email: "child@school.kz", email_verified: true } },
  ]), null);
  assert.equal(verifiedGoogleIdentityEmail(null), null);
});

test("Google sign-in returns to an internal route and asks shared devices to choose an account", () => {
  const config = googleOAuthOptions("https://ai-teacher-test-generator.vercel.app");
  assert.equal(config.provider, "google");
  const redirect = new URL(config.options.redirectTo);
  assert.equal(redirect.origin, "https://ai-teacher-test-generator.vercel.app");
  assert.equal(redirect.pathname, "/login");
  assert.equal(redirect.search, "");
  assert.equal(config.options.scopes, "openid email profile");
  assert.equal(config.options.queryParams.prompt, "select_account");
  assert.match(login, /signInWithOAuth/);
  assert.match(login, /safeNext\(requestedNext/);
  assert.match(login, /oauthRequestedNext\(requestedNext\)/);
  assert.match(login, /sessionStorage\.removeItem\("ai_teacher_oauth_next"\)/);
  assert.match(login, /sessionStorage\.removeItem\("ai_teacher_oauth_next"\)/);
  assert.match(login, /hashParams\.get\("error_description"\)/);
});

test("class rosters cannot self-assign teacher roles and API mutations require teachers", () => {
  assert.match(classApi, /actor\.role !== "teacher"/);
  assert.match(classApi, /normalizedClassEmails/);
  assert.match(baseSchema, /coalesce\([\s\S]*raw_user_meta_data->>'full_name'[\s\S]*raw_user_meta_data->>'name'[\s\S]*'student'/i);
  assert.match(migration, /'student'\s*\) on conflict/i);
  assert.doesNotMatch(migration, /raw_user_meta_data\s*->>\s*'role'/i);
});

test("share creation binds an active teacher-owned class and clears per-link email rules", () => {
  assert.match(shareApi, /\.eq\("owner_id", actor\.id\)\.eq\("is_active", true\)/);
  assert.match(shareApi, /class_id: classId/);
  assert.match(shareApi, /settings: classId \? \{ \.\.\.settings, allowed_students: \[\] \} : settings/);
});

test("class-restricted share links require an explicit teacher selection", () => {
  const page = readFileSync(root("../app/tests/[id]/page.tsx"), "utf8");
  assert.match(page, /useState\(""\);\s*const \[classLoadError/);
  assert.doesNotMatch(page, /setSelectedClassId\(current => current \|\| classResult\.classes\.find/);
});

test("every class-scoped open, draft, and submit path verifies the enrolled student", () => {
  assert.match(shareAccess, /classRow\.owner_id !== link\.owner_id/);
  assert.match(shareAccess, /\.eq\("student_id", actor\.id\)/);
  assert.match(shareAccess, /actor\.hasGoogleIdentity/);
  assert.match(shareAccess, /actor\.googleEmail/);
  assert.match(shareAccess, /byStudentId\.email !== actor\.googleEmail/);
  assert.match(shareAccess, /\.eq\("email", actor\.googleEmail\)/);
  assert.match(shareAccess, /\.update\(\{ student_id: actor\.id \}\)/);
  assert.match(shareAccess, /This account is not enrolled in the selected class/);
  assert.match(auth, /identity\.provider === "google"/);
});

test("legacy links continue working before the class migration is installed", () => {
  assert.match(shareAccess, /isMissingClassSchema\(linkError\)/);
  assert.match(shareAccess, /class_id: null/);
  assert.match(compat, /PGRST204|42703/);
  assert.match(shareApi, /isMissingClassSchema\(error\)/);
  assert.match(shareApi, /\.\.\.\(classId \? \{ class_id: classId \} : \{\}\)/);
});

test("class migration is additive, keeps old links unscoped, and protects class and roster rows with RLS", () => {
  assert.match(migration, /add column if not exists class_id uuid references public\.web_classes\(id\) on delete restrict/i);
  assert.match(migration, /alter table public\.web_classes enable row level security/i);
  assert.match(migration, /alter table public\.web_class_members enable row level security/i);
  assert.match(migration, /unique \(class_id, email\)/i);
  assert.match(migration, /web_class_members_student_unique/i);
  assert.match(migration, /class_id is null or exists \([\s\S]*c\.owner_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration.replace(/^--.*$/gm, ""), /\b(delete from public\.web_share_links|truncate|drop table)\b/i);
});
