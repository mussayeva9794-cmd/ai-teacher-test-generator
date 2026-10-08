-- Apply after a verified database backup and before deploying manual-review code.
-- Scores are NULL while non-exact free-text answers await a teacher's final score.
alter table public.web_attempts
  alter column percentage drop not null;
