# AI Teacher school release readiness

Checked on 2026-10-14. This report describes observed state, not a release approval.

## Decision

**No-go for a school-wide exam on the new Google/classes release yet.** The code branch has green CI, but its Preview is protected by Vercel SSO, the public production deployment does not expose the classes API, and the authenticated teacher/student exam path has not been verified on the current Preview. Keep PR #3 in Draft until the checks below pass.

The current public site is reachable. Its health endpoint returned HTTP 200 and reported Supabase Admin API and Groq/model connectivity as healthy. This is only a service check; it does not prove sign-in, database policies, test generation, or exam submission.

## Evidence collected

- Git working tree was clean before this report and the security patch; checked-out branch was `release/school-pilot-hardening` tracking `origin/release/school-pilot-hardening`.
- GitHub PR #3, “Merge Google sign-in and class-based tests into main”, is open, Draft, not merged, and reported mergeable. Head: `03a5c6bdb8fdf97d766afa299d2fe6b996396342`; base: `main` at `62c09b53f8c921f4c0fe7fff5c6673b09be51a0e`.
- GitHub Actions Web CI run 12 passed on the PR head: unit tests, TypeScript check, `npm audit`, production build, and Playwright smoke. The smoke tests are unauthenticated and are not an exam acceptance test.
- Local sequential unit run passed 74/74 tests after the legacy-lockdown regression test was added. A parallel local run stalled in this filesystem and was stopped; it was not counted as a pass.
- A direct unauthenticated request to the PR Preview returned HTTP 302 to Vercel SSO. The Preview cannot be used by pupils until the deployment is accessible to the test team; do not disable project protection as a workaround.
- Public production returned HTTP 200 for `/` and `/login?mode=signup`, and `/api/health` returned HTTP 200 with Supabase and Groq healthy. `/classes` and `/api/classes` returned HTTP 404, so the class feature from the PR is not on the currently observed production deployment. `/api/tests/<id>/share` rejected an unauthenticated request with HTTP 401, as expected.
- No Vercel team was visible to the current integration, and no Supabase connector was available. Production database state, deployment configuration, OAuth configuration, and logs were not inspected or changed.

## Code changes in this checkout

The legacy Python schema contains `teacher_audit_logs`, `teacher_usage_events`, `teacher_groups`, `teacher_group_students`, and `schema_meta`, but the legacy-table lockdown omitted them. The lockdown list now includes all tables declared in `supabase_schema.sql`, and a regression test compares the two lists. This is a repository change only: the SQL has **not** been applied to Supabase.

The added lockdown regression test passed in the targeted suite (16/16), and the complete sequential web unit suite passed (74/74). GitHub CI cited above is for the earlier PR head; the new patch still needs its own CI run.

The inspected PR code also has these properties, which still require live validation:

- New profiles are assigned `student`; teacher operations read the stored profile role.
- Class-based access requires a Google identity with a verified matching email and an enrolled roster entry.
- Teacher class and share-link mutations use the signed-in teacher's identity and owner-scoped queries.
- Attempt insertion handles PostgreSQL unique-violation errors. The database must actually have `UNIQUE (test_id, student_id)` for concurrent duplicate submissions to be safely rejected.
- Timed tests rely on the student's page to submit. If the student closes it and does not return, the last draft is not automatically finalized by a server scheduler. Do not use a timer for a high-stakes first exam.
- A share link with no selected class and an empty email allowlist is open to any signed-in student. For a school exam, select the intended class or explicitly configure an allowlist and test a non-member denial.

## Release gates

### Before Preview acceptance

1. Restore authorized Vercel team/project access. Keep Deployment Protection enabled; use a separate staging Supabase project for Preview, never production secrets or student data.
2. Confirm Preview environment variables and Supabase Google OAuth redirect URLs. Do not put OAuth secrets, database URIs, or API keys in Git, chat, screenshots, or student-facing settings.
3. Apply only the reviewed migrations to Staging, after a backup. Re-run the read-only audit and verify RLS, policies, grants, profile trigger, class schema, RPC privileges, zero duplicate attempts, and the unique attempt constraint.
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
- **Project owner / Supabase administrator:** restore Vercel access, maintain OAuth and environment variables, perform and retain backups, review/apply database migrations, and verify Production grants/RLS. Credentials stay in their vendor dashboards.
- **Teacher:** rehearse the class-scoped test, confirm the roster and instructions, test with one pupil, and check results before the actual assessment.

## What this report does not claim

It does not claim that Preview authentication, Google OAuth, production RLS/grants, the current Production schema, a 20–25-user load, mobile behavior, or a real BJB exam has passed. Green CI and a healthy endpoint are necessary, not sufficient, for school release.
