-- Schedule server-side submission of expired saved drafts.
-- Apply only after a verified backup and the attempt-window RPC migration.
-- This script does not create or change student attempts by itself; the scheduled
-- HTTP call invokes the application route, which finalizes only expired drafts.
--
-- Before running this script in Supabase SQL Editor:
-- 1. Generate a random CRON_SECRET of at least 32 characters.
-- 2. Store that exact value as CRON_SECRET in Vercel for the same environment.
-- 3. In Supabase Vault, create these secrets (values must never be committed):
--    select vault.create_secret('https://YOUR-PRODUCTION-HOST/api/internal/finalize-expired-drafts', 'ai_teacher_finalizer_url');
--    select vault.create_secret('YOUR-CRON-SECRET', 'ai_teacher_finalizer_secret');
-- 4. Replace YOUR-PRODUCTION-HOST above with the permanent public host, not a Preview URL.
--
-- Prerequisites: Supabase Cron (pg_cron), pg_net, and Vault are enabled. Use the
-- Supabase Cron dashboard if your project policy requires scheduled jobs there.

do $block$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'ai-teacher-finalize-expired-drafts';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'ai-teacher-finalize-expired-drafts',
    '* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'ai_teacher_finalizer_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ai_teacher_finalizer_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );
end;
$block$;

-- Verify after the next minute. A successful request is HTTP 200 with counters;
-- it must not expose answers, emails, or tokens in SQL logs.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'ai-teacher-finalize-expired-drafts';
