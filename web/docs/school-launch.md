# School pilot launch checklist

The code changes in this repository do not update Supabase or Vercel automatically. Do not invite a class until the production migration, email delivery, backups and multi-account test have passed.

## 1. Teacher access and generation quota

1. Back up the database first. In Supabase SQL Editor, run `supabase_launch_hardening.sql` against the production project, followed by `supabase_generation_quota_window_refund.sql` before deploying code that uses the v2 quota RPCs. The first migration makes every newly registered account a student and creates the five-per-hour quota; the second ensures failed generations refund the exact hour they reserved, including across an hour boundary. Requests fail closed if the matching migration is missing.
2. Review current teacher accounts before launch; the migration intentionally does not demote them:

```sql
select u.email, p.role, p.created_at
from public.web_profiles p join auth.users u on u.id = p.id
where p.role = 'teacher'
order by p.created_at;
```

3. Only after verifying a teacher's identity, a database administrator can promote that existing account in SQL Editor:

```sql
update public.web_profiles p set role = 'teacher'
from auth.users u
where p.id = u.id and lower(u.email) = lower('verified.teacher@school.example');
```

Check that exactly one row changed. Never execute a promotion based solely on an unverified email or user-supplied metadata. Demote an unauthorized existing profile using the same join with `set role = 'student'`. No browser client has permission to update this table.

4. Deploy the matching code after the SQL migration. Test a fresh sign-up that supplies `role=teacher` in user metadata manually; its `web_profiles.role` must still be `student`. Test an approved teacher account and confirm it can generate while a student cannot.

## 2. Enrollment without a school domain

The school does not currently have a sender domain. Supabase's built-in Auth mailer is only for small tests and is limited to two messages per hour; it is not a whole-class registration solution. Keep email confirmation enabled. Do not pre-confirm arbitrary addresses, distribute a shared password or turn off confirmation to work around the mailer. See [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Choose one enrollment path before inviting a class:

- If every pupil has a school-approved Google account, implement and configure [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google). This avoids confirmation emails for Google sign-in; Google Cloud OAuth settings and a real-device sign-in test are still required. This path is **not yet implemented** in this app.
- Otherwise obtain an approved sender identity and a custom SMTP provider or Send Email hook. The sender need not match the public `vercel.app` website address, but it must satisfy the mail provider's verification and delivery rules. Verify confirmation, password reset, delivery to pupils, and the provider's hourly quota before bulk enrollment.

Until one path is configured and tested, keep enrollment to a few test users and do not advertise the site to a whole class.

## 3. Backup and recovery

For a free Supabase project, install PostgreSQL client tools and run `bash scripts/backup-supabase.sh` with `SUPABASE_DB_URL` in a private environment. Obtain the Session Pooler connection string from Supabase Connect; never put it in Git, chat, a screenshot or a command committed to shell history. The script writes a timestamped `public.dump` and `SHA256SUMS` under `~/AI-Teacher-Backups` by default. **This dump covers only the public schema; it does not include Supabase Auth users, Storage objects or project Auth settings/keys.** A directory beginning `.incomplete-` is a failed dump, not a backup; only a completed timestamped directory with a valid `SHA256SUMS` counts. Back up before each migration and at least daily during the pilot. Keep an encrypted off-device copy with restricted access; never put student data in a public repository or unencrypted CI artifact.

At least once, restore into a **separate disposable Supabase project**, following [Supabase's restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Confirm that public tests, attempts and profiles can be read there. Auth users require a separate recovery plan; foreign keys to `auth.users` may prevent a standalone public-schema restore. A successful dump without a restore test is not a verified recovery plan. Auth settings, keys, storage objects and custom triggers/policies need separate review.

Before production rollout, additionally run `supabase_school_production_audit.sql` and keep its private output. If the attempt-duplicate query returns any rows, stop and agree how to preserve/resolve those records; never delete attempts just to make a migration pass. Only if the unique constraint is missing, run `supabase_attempts_unique_constraint.sql` during a quiet period after a zero-duplicate audit; it locks `web_attempts` while it checks for races. Run `supabase_manual_review.sql` (nullable pending scores), `supabase_results_summary.sql` (RLS-respecting aggregate RPC), and `supabase_legacy_public_tables_lockdown.sql` before deploying the matching code. Verify the unique constraint, RLS, grants, policies, and RPC privileges again afterward.

## 4. Monitoring and spend

The [production health workflow](../../.github/workflows/production-health.yml) checks `/api/health` hourly, retries transient failures, opens one GitHub issue if the service is unhealthy, and closes it on recovery. It becomes active only after the workflow is pushed to GitHub. Enable GitHub notifications for repository issues and failed Actions; this is an hourly alert, not continuous monitoring. Review Vercel Function logs after each class test, but never log passwords, passkeys, answer bodies, student email addresses or API keys. Set a Groq organization monthly spending limit and 50/75/90% alerts in Settings > Billing > Limits if the account tier supports it; otherwise monitor usage manually. The server-side five-per-calendar-hour successful-generation quota prevents one teacher account from rapidly exhausting Groq requests, but it does not replace the provider's financial limit. See [Groq spend limits](https://console.groq.com/docs/spend-limits).

## 5. Public access and end-to-end acceptance

Use `https://ai-teacher-test-generator.vercel.app`, not an autogenerated deployment URL. In Vercel, use Standard Protection for previews, not All Deployments for the production domain. From a private browser and a separate phone, confirm the landing page opens **without** a Vercel login. A student must still sign in to AI Teacher. See [Vercel deployment protection](https://vercel.com/docs/deployment-protection).

Use at least two teacher accounts and two student accounts, plus an unregistered visitor, in separate browser profiles. Complete this matrix after every production release:

| Scenario | Expected result |
| --- | --- |
| New account asks for teacher in metadata | Stored role is student; teacher API returns 401/403 |
| Teacher A creates, edits, publishes and shares a test | Link uses the stable production domain |
| Teacher B opens A's test/results | Denied; no questions, answers or results leaked |
| Allowed student opens link, refreshes, submits | Draft survives refresh; one attempt stored; score visibility follows settings |
| Same student retries through another link | Database rejects the second attempt for that test |
| Unlisted student opens restricted link | Denied |
| Timer expires or deadline passes | New answers are rejected; the last server-saved draft can still be submitted |
| Timer expires while the test page stays open | The page submits the last server-saved draft; edits not yet saved before expiry are not guaranteed |
| Student closes the page before expiry and does not return | The draft remains in the database but is not automatically submitted or visible in results; do not use timed links for high-stakes assessments until server-side expiry processing exists |
| Non-exact short answer | No guessed score; attempt is marked for teacher review, then teacher records final percent |
| Teacher A opens results and exports CSV | Names, scores and export match stored attempts |
| Preview link and production link in private window | Preview may require Vercel; production must not |

Record the date, deployment ID and evidence for each result. This checklist is not a claim that those live scenarios have already passed.

The GitHub `Web CI` workflow runs dependency audit, unit tests, typecheck, production build and unauthenticated Playwright smoke tests. These checks do not authenticate as a real teacher/student or exercise live Supabase/Groq. A full multi-account acceptance run still requires a staging Supabase project and dedicated disposable test accounts; do not point concurrency or destructive tests at school production.
