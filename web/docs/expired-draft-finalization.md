# Expired draft finalization

The student page saves drafts while it is open, but a browser tab cannot run after it is closed. The application route `POST /api/internal/finalize-expired-drafts` finalizes only the last server-saved draft after its timer or deadline has expired.

## Required setup

1. Deploy the matching application version first.
2. Set a unique random `CRON_SECRET` of at least 32 characters in Vercel for the target environment. Do not use the Supabase service key, Google secret, Groq key, or a value sent through chat.
3. Follow the comments in `supabase_expired_draft_finalizer.sql` to put the permanent application URL and the same secret in Supabase Vault, then schedule the job once per minute with Supabase Cron.
4. Create a short QA test with a one-minute timer. Answer one question, wait for the draft to show as saved, close the tab, then wait at least two minutes. The teacher must see one submitted attempt containing the saved answer. Repeat with a deadline-based test.
5. Inspect Cron and Vercel logs without copying student answers or personal data. If the job fails, disable timed assessment links until it is corrected; drafts remain available, but they are not proof of a submitted test.

The job scans at most 100 drafts per run. This is suitable for the school pilot; monitor job duration and results before increasing scale. It never submits an open draft early and relies on `finalize_web_attempt` to make the final database-clock decision.
