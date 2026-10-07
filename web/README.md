# AI Teacher on Vercel

This is a separate Next.js application for Vercel. The existing Streamlit app at the repository root is not modified by this deployment. Do not switch the public URL until the new app passes end-to-end testing.

## What has been migrated

- Supabase Auth registration and sign-in for teachers and students.
- Teacher library, Groq-based generation of four test variants, question editing, publication and archiving.
- Share links with whitelist, deadline, timer, deterministic question/option randomization, one question at a time and optional score reveal.
- Student autosaved draft, one submitted attempt per student account and test (database unique constraint), server-side grading, teacher results journal and CSV export.
- Optional passkey sign-in through Face ID, Touch ID, a device PIN, or a security key. Password sign-in remains available.

## Not yet migrated

Legacy Streamlit account passwords and existing test/attempt history are **not** automatically moved into Supabase Auth or the `web_*` tables. Existing users must register again until a verified migration is written. The Streamlit-only gradebook, question bank, groups, billing UI, backup UI and additional analytics are also not included. Keep the old app available while these features are migrated if you rely on them.

## One-time setup

1. In the existing Supabase project, open SQL Editor and run [`supabase_v2.sql`](./supabase_v2.sql). It creates new `web_*` tables without deleting old data. Do not paste credentials into SQL or Git.
2. In Supabase Auth settings, enable Email authentication and add your eventual Vercel domain to the redirect URL allowlist. Decide whether email confirmation is required.
3. In Vercel, import `mussayeva9794-cmd/ai-teacher-test-generator` from GitHub. Set **Root Directory** to `web`, Framework Preset to Next.js, and Node.js to a supported version. Do not replace the existing Streamlit deployment yet.
4. Add these Vercel environment variables to Production and Preview:
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key (not the secret key).
   - `SUPABASE_SECRET_KEY`: Supabase secret/service-role key; server-side only, never prefix with `NEXT_PUBLIC_`.
   - `GROQ_API_KEY`: Groq API key; server-side only.
   - `GROQ_MODEL`: optional; defaults to `openai/gpt-oss-20b`.
5. Deploy a **preview** first. Open `/api/health` and confirm both `*_configured` flags are true. Test student sign-up, administrator-approved teacher access, generation, publication, one submission, teacher results and repeat-attempt denial. Promote to production only after that.

## School pilot hardening

Run [`supabase_launch_hardening.sql`](./supabase_launch_hardening.sql) on an existing production database **before** deploying the code that uses it. New public registrations are students only. Existing teacher profiles are preserved; a database administrator must verify and promote new teachers. Generating tests is limited to five requests per teacher per hour in Postgres. If the migration is missing, generation fails closed rather than sending an unmetered Groq request.

The complete release, class-email, backup, monitoring and multi-account acceptance procedure is in [`docs/school-launch.md`](./docs/school-launch.md). The local backup helper is [`scripts/backup-supabase.sh`](./scripts/backup-supabase.sh). Neither a successful build nor `/api/health` proves a real teacher/student test flow.

## Passkey setup

In Supabase Authentication > Passkeys, enable passkeys and use `ai-teacher-test-generator.vercel.app` as the Relying Party ID and `https://ai-teacher-test-generator.vercel.app` as the allowed origin. The public origin must remain stable: switching domains requires users to register new passkeys. Supabase currently labels this feature experimental. Users must first sign in with a confirmed email, then register a passkey at `/account`. The existing email/password flow is the recovery path. Preview deployments have different origins and cannot register or use this production passkey.

## Local development

From the `web` directory, set variables from `.env.example` in a private `.env.local` and run:

```bash
npm ci
npm run test
npm run typecheck
npm run build
npm run dev
```

The publishable key is visible in the browser by design. The secret key and Groq key must remain in Vercel server environment only. Never commit `.env.local` or output the keys in logs.

Student links always use the public production domain, even when a teacher opens a protected Vercel preview. If the project later moves to a custom domain, set `PUBLIC_APP_URL` to its HTTPS origin in Vercel and redeploy. Students open `/s/<token>` directly, then sign in or register with the site's own account; they do not need a Vercel account.
