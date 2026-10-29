import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRosterNameSchema } from "./schema-compat";

const ROWS_PER_PAGE = 1000;

export type RosterNameRow = { class_id: string; student_id: string; full_name: string };

/**
 * Picks the roster name for one attempt: the name in the class the test link
 * was shared with, else the student's name in another of the teacher's
 * classes (the first by class id, so the choice is stable).
 */
export function rosterNameFor(rows: RosterNameRow[]) {
  const byClass = new Map<string, string>();
  const anyClass = new Map<string, string>();
  for (const row of [...rows].sort((a, b) => a.class_id.localeCompare(b.class_id))) {
    byClass.set(`${row.class_id}:${row.student_id}`, row.full_name);
    if (!anyClass.has(row.student_id)) anyClass.set(row.student_id, row.full_name);
  }
  return (studentId: string, classId: string | null | undefined) =>
    (classId ? byClass.get(`${classId}:${studentId}`) : undefined) ?? anyClass.get(studentId) ?? null;
}

/**
 * Typed names of these students in the signed-in teacher's own classes.
 * `db` must be the teacher's client: row-level security limits the rows to
 * classes they own. A database without the roster migrations has no typed
 * names, so the result is empty; null means the roster could not be read.
 */
export async function rosterNames(db: SupabaseClient, studentIds: string[]): Promise<RosterNameRow[] | null> {
  const unique = [...new Set(studentIds)];
  const rows: RosterNameRow[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const chunk = unique.slice(offset, offset + 100);
    // A student can be in many classes, so read every page, not just the first 1000 rows.
    for (let from = 0; ; from += ROWS_PER_PAGE) {
      const { data, error } = await db.from("web_class_members")
        .select("class_id,student_id,full_name").in("student_id", chunk)
        .not("full_name", "is", null).order("id").range(from, from + ROWS_PER_PAGE - 1);
      if (isMissingRosterNameSchema(error)) return [];
      if (error) return null;
      rows.push(...((data || []) as RosterNameRow[]));
      if (!data || data.length < ROWS_PER_PAGE) break;
    }
  }
  return rows;
}
