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
