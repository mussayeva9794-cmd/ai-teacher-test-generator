-- Apply after a verified backup and before deploying code that calls this RPC.
-- SECURITY INVOKER deliberately preserves the caller's RLS policies; a teacher
-- can aggregate only attempts already visible to that authenticated account.
create or replace function public.web_test_attempt_summary(p_test_id uuid)
returns table(total_count bigint, graded_count bigint, pending_review bigint, average numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(a.percentage)::bigint,
    (count(*) - count(a.percentage))::bigint,
    coalesce(round(avg(a.percentage), 2), 0)::numeric
  from public.web_attempts a
  join public.web_tests t on t.id = a.test_id
  where a.test_id = p_test_id
    and t.owner_id = (select auth.uid());
$$;

revoke all on function public.web_test_attempt_summary(uuid) from public, anon;
grant execute on function public.web_test_attempt_summary(uuid) to authenticated;
