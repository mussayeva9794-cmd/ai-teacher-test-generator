# AI Teacher school release readiness

Checked on 2026-10-14. This report describes observed state, not a release approval.

## Decision

**No-go for a school-wide exam on the new Google/classes release yet.** The current committed branch has green CI and Staging is isolated from Production, but unauthenticated Preview visitors are still gated by Vercel SSO, Staging's Google redirect allowlist still points to an older Preview URL, and the authenticated teacher/student exam path has not been verified on the current Preview. The public Production deployment still returns 404 for `/classes` and `/api/classes`. Additional fail-closed code changes are now uncommitted locally and have not run through CI. Keep PR #3 in Draft until the checks below pass.

The public Production home page and `/api/health` returned HTTP 200. Health reported Supabase Admin API and Groq/model connectivity as healthy. This is only a service check; it does not prove sign-in, database policies, test generation, or exam submission.

## Evidence collected

- Checked-out branch is `release/school-pilot-hardening`, tracking origin at `269c4ff7dcf30a62f10f891cbe5da976b3759585` (`269c4ff`, “Update release readiness evidence”). Local changes are uncommitted in the share API/access flow, login profile handling, tests, and this report. The untracked `.codex/` path was left untouched.
- GitHub PR #3, “Merge Google sign-in and class-based tests into main”, is open, Draft, not merged, and mergeable. Its head is the checked-out `269c4ff`; base branch is `main`. Both current Web CI checks passed, along with the Vercel Preview check. CI includes tests, TypeScript check, audit, build, and unauthenticated smoke; it is not an authenticated exam acceptance test.
- Current local `npm test` passed 79/79. Local full `npm run typecheck` and `npm run build` were tried with Node 22.23.3 and stalled; a repeat full typecheck under Node 26.4.0 also did not finish. `tsc --listFilesOnly` likewise exceeded 90 seconds. A standalone check of the two small helper modules passed, but that is not a project typecheck. The sampled compiler was processing TypeScript inputs; the root cause remains undiagnosed. GitHub CI for the committed `269c4ff` reports checks successful, but it does not include the current working-tree changes.
- Current Preview deployment is Ready at `https://ai-teacher-test-generator-am3zm7nh0-kuma-b5e0.vercel.app/` (deployment `hSZghSkioE5h5mRFTuZFzbX5DdUy`, commit `269c4ff`). A browser session opened from the authenticated Vercel dashboard rendered the public landing and login form, including Google and passkey controls. Unauthenticated `curl` requests to the Preview root and `/api/health` returned HTTP 302 to Vercel SSO. Thus the route can be viewed in an authenticated Vercel browser, but it is not yet demonstrated as student-accessible without Vercel login. Do not disable Deployment Protection as a workaround.
- Production `https://ai-teacher-test-generator.vercel.app/` returned HTTP 200. `/api/health` returned HTTP 200 with Supabase Admin API and Groq/model connectivity healthy. `/classes` and `/api/classes` returned HTTP 404, so the classes feature is not present on current Production. This health response does not prove end-user workflows.
- A separate Supabase project, **AI Teacher Staging** (`gqpihfailmbxxnmugqzz`), is configured in the branch-specific Preview environment; Production uses its own Supabase project. No secret values were revealed. Staging has eight `web_*` tables with RLS enabled; `web_attempts` has `UNIQUE (test_id, student_id)`, zero duplicate pairs, and one existing attempt. Read-only audit found the seven expected policies and no additional policies; their expressions match the owner/teacher/self restrictions in the checked-in SQL. No `PUBLIC` or `anon` table grants were found. No Auth users are missing a `web_profiles` row. RPC execute grants also match the intended migration: quota reservation and attempt summary are callable by `authenticated` (and the DB owner), while quota release is restricted to `service_role` (and the DB owner); no `PUBLIC` or `anon` execute grants were found. Google provider and email confirmation are enabled; anonymous sign-in is disabled. These checks validate Staging structure, not the full app flow or Production.
- Staging Site URL and Redirect URLs still point to an older Preview host (`ai-teacher-test-generator-git-release-school-p-5117aa-kuma-b5e0.vercel.app`), not the current deployment. The current callback shown in Staging is `https://gqpihfailmbxxnmugqzz.supabase.co/auth/v1/callback`. No OAuth allowlist or provider settings were changed. Staging also has duplicate Preview `GROQ_API_KEY` entries (generic and branch-specific); values were not revealed or changed.
- Supabase dashboard access is available in the browser and read-only Staging SQL checks were performed, including policy expressions, grants, constraints, duplicate-attempt count, and profile completeness. A malformed first SELECT was corrected; it did not modify data. No migrations, Production database queries, permission changes, or deployment changes were performed this turn.

## Code changes in this checkout

The legacy Python schema lockdown now includes every table declared in `supabase_schema.sql`, with a regression test comparing the lists. Additional uncommitted changes now require share links to have an explicit class, email allowlist, or open-access confirmation; validate and normalize up to 100 email addresses; keep student access fail-closed if the class schema is unavailable while allowing the teacher's read-only link list to fall back to legacy columns; and surface a failed profile lookup instead of silently routing an authenticated user. These are repository changes only and are not deployed.

The complete sequential web unit suite passed (79/79). The Staging table, policy, constraint, profile, and RPC-grant audits passed the listed structural checks. The local full TypeScript check and production build still do not complete even under Node 22.23.3; the standalone helper typecheck is only partial evidence. GitHub CI run 14 and current PR checks passed on committed `269c4ff`, not on the uncommitted changes described above.

The inspected PR code also has these properties, which still require live validation:

- New profiles are assigned `student`; teacher operations read the stored profile role.
- Class-based access requires a Google identity with a verified matching email and an enrolled roster entry.
- Teacher class and share-link mutations use the signed-in teacher's identity and owner-scoped queries.
- Attempt insertion handles PostgreSQL unique-violation errors. The database must actually have `UNIQUE (test_id, student_id)` for concurrent duplicate submissions to be safely rejected.
- Timed tests rely on the student's page to submit. If the student closes it and does not return, the last draft is not automatically finalized by a server scheduler. Do not use a timer for a high-stakes first exam.
- Existing share links with no selected class and an empty email allowlist remain open to any signed-in student by design. New share links now require an explicit class, email allowlist, or confirmed open access. This is not yet live until the branch is reviewed, pushed, and deployed.
- The teacher's read-only share-link list can still show legacy links before the classes migration, but creating class-scoped links and opening tests through the student path require the class schema. Apply and verify the migration before deploying the new classes release.

## Release gates

### Before Preview acceptance

1. Decide how to make Preview available for a controlled school rehearsal while preserving Deployment Protection. Current unauthenticated requests are SSO-gated; do not expose a temporary bypass or disable protection without an explicitly approved access plan. Continue using Staging, never Production secrets or real student data, for rehearsal.
2. Correct the Staging Supabase Site URL and narrowly scoped Redirect URL allowlist for the current Preview only after the owner approves the exact host; verify the Google Cloud OAuth client includes the Staging callback. Do not put OAuth secrets, database URIs, or API keys in Git, chat, screenshots, or student-facing settings.
3. Staging already has the class schema and passed the current read-only policy/grant/constraint/profile/RPC audit. Before another migration, compare the exact migration state and backup; do not reapply schema blindly. Production privileges remain unverified.
4. On disposable accounts, test Google sign-in for a teacher and student, first and repeat login, class creation, roster enrollment, a member allow, a non-member deny, test generation, edit, publication, and stable-link access.
5. Test student draft save/reload, ordinary submission, retry denial, two concurrent submissions (exactly one attempt), deadline behavior, teacher results, and downloaded CSV contents.
6. Rehearse with 20–25 synthetic students against Staging only. Record latency, errors, duplicate count, and database/API limits. Do not send concurrent or destructive test traffic to school production.
7. For the first real BJB, disable the timer unless server-side expiry finalization is added and verified. Have the teacher publish a class-scoped link and test it with one disposable student before sharing it with the class.

### Production release

1. Take a fresh database backup and verify its checksum; separately record how Supabase Auth users, Storage, and project Auth settings will be recovered.
2. Run `supabase_school_production_audit.sql` read-only and review the private results. Do not paste student emails or policy output into a public issue or chat.
3. Confirm the production migration plan, expected row counts, rollback/forward-fix plan, class-roster behavior, and the approved teacher-account list. Never resolve duplicate attempts by deleting rows without an explicit retention decision.
4. After all Staging gates pass, move PR #3 out of Draft for review. Merge only after an explicit release decision. Confirm Vercel production deployment is Ready and verify the permanent `vercel.app` URL without a Vercel login in a private browser.
5. Run one approved teacher/student acceptance test on production, inspect function logs for errors without exposing student data, verify the result and CSV, then close the QA link and remove disposable test records using the app's normal recovery path.

## Ownership

- **Engineering:** maintain the release branch, close code/test defects, keep the CI gate green, and document migration/rollback steps.
- **Project owner / Supabase administrator:** approve a student-safe Preview access plan and the exact OAuth redirect host, maintain provider/environment configuration, perform and retain backups, review/apply database migrations, and verify Production grants/RLS. Credentials stay in their vendor dashboards.
- **Teacher:** rehearse the class-scoped test, confirm the roster and instructions, test with one pupil, and check results before the actual assessment.

## What this report does not claim

It does not claim that Preview authentication, Google OAuth on the current deployment, Production RLS/grants, the current Production class schema, a 20–25-user load, mobile behavior, or a real BJB exam has passed. The new local code changes have not passed CI or an authenticated end-to-end test. Green CI for the previous commit and a healthy endpoint are necessary, not sufficient, for school release.
