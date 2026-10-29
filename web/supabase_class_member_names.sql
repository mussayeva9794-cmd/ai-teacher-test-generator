-- Mugalim AI: the teacher may type a student's full name ("Фамилия Имя") next
-- to the email in a class roster. Additive and nullable: existing rows and
-- older app versions keep working. Row-level security on web_class_members
-- already limits the column to the class owner.
alter table public.web_class_members
  add column if not exists full_name text
  constraint web_class_members_full_name_check check (
    full_name is null or (
      full_name = btrim(full_name)
      and char_length(full_name) between 1 and 120
      and full_name !~ '[[:cntrl:]]'
    )
  );

-- Adds students to a class in one statement. A typed name replaces the stored
-- one; a line without a name keeps whatever name the roster already has, even
-- if another request wrote it a moment earlier. Runs as the calling teacher,
-- so row-level security still limits it to classes they own.
create or replace function public.add_web_class_members(p_class_id uuid, p_students jsonb)
returns integer language sql security invoker set search_path = '' as $$
  with input as (
    select distinct on (lower(btrim(item->>'email')))
      lower(btrim(item->>'email')) as email, nullif(btrim(item->>'full_name'), '') as full_name
    from jsonb_array_elements(p_students) as item
    order by lower(btrim(item->>'email')), (nullif(btrim(item->>'full_name'), '') is null)
  ), saved as (
    insert into public.web_class_members (class_id, email, full_name)
    select p_class_id, email, full_name from input
    on conflict (class_id, email) do update
      set full_name = coalesce(excluded.full_name, public.web_class_members.full_name)
    returning 1
  )
  select count(*)::integer from saved;
$$;
revoke all on function public.add_web_class_members(uuid, jsonb) from public, anon;
grant execute on function public.add_web_class_members(uuid, jsonb) to authenticated;
