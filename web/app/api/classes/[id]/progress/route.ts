import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { classProgress, type ProgressAttempt } from "@/lib/progress";

const PAGE = 1000;
// The latest 100 tests keep the id list well inside PostgREST's URL limit.
const MAX_TESTS = 100;
const MAX_ATTEMPTS = 20000;
import { userClient } from "@/lib/supabase";
import { profileNames } from "@/lib/student-lookup";

/** One class's results across this teacher's tests. Reads only rows the teacher owns. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const db = userClient(actor.accessToken);
  const { data: classRow, error: classError } = await db.from("web_classes").select("id")
    .eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (classError) return jsonError("Could not verify class access.", 503);
  if (!classRow) return jsonError("Class not found or could not be updated.", 404);
  const [{ data: members, error: memberError }, { data: tests, error: testError }] = await Promise.all([
    db.from("web_class_members").select("email,student_id,full_name").eq("class_id", id),
    db.from("web_tests").select("id,title").eq("owner_id", actor.id).order("created_at", { ascending: false }).limit(MAX_TESTS + 1),
  ]);
  if (memberError || testError) return jsonError("Could not load results.", 503);
  const studentIds = (members || []).flatMap((member) => member.student_id ? [member.student_id as string] : []);
  // Say so when the view covers only the latest tests or attempts.
  let truncated = (tests || []).length > MAX_TESTS;
  const shown = (tests || []).slice(0, MAX_TESTS);
  const testIds = shown.map((test) => test.id as string);
  // Names of students in this teacher's own class roster only.
  const names = await profileNames(studentIds);
  if (!names) return jsonError("Could not load results.", 503);
  if (!studentIds.length || !testIds.length) return Response.json({ ...classProgress(members || [], shown, [], names), truncated });
  // PostgREST returns at most 1,000 rows per request: page through with a
  // (submitted_at, id) cursor, as the CSV export does.
  const attempts: ProgressAttempt[] = [];
  let cursor: { submitted_at: string; id: string } | null = null;
  while (true) {
    if (attempts.length >= MAX_ATTEMPTS) { truncated = true; break; }
    let query = db.from("web_attempts").select("id,test_id,student_id,percentage,submitted_at")
      .in("test_id", testIds).in("student_id", studentIds)
      .order("submitted_at", { ascending: true }).order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.or(`submitted_at.gt.${cursor.submitted_at},and(submitted_at.eq.${cursor.submitted_at},id.gt.${cursor.id})`);
    const { data, error: attemptError } = await query;
    if (attemptError) return jsonError("Could not load results.", 503);
    const batch = (data || []) as (ProgressAttempt & { id: string })[];
    attempts.push(...batch);
    if (batch.length < PAGE) break;
    const last = batch[batch.length - 1];
    cursor = { submitted_at: last.submitted_at, id: last.id };
  }
  return Response.json({ ...classProgress(members || [], shown, attempts, names), truncated });
}
