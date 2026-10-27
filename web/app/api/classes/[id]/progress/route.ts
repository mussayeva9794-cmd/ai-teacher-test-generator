import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { classProgress } from "@/lib/progress";
import { userClient } from "@/lib/supabase";

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
    db.from("web_class_members").select("email,student_id").eq("class_id", id),
    // The latest 100 tests keep the id list well inside PostgREST's URL limit.
    db.from("web_tests").select("id,title").eq("owner_id", actor.id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (memberError || testError) return jsonError("Could not load results.", 503);
  const studentIds = (members || []).flatMap((member) => member.student_id ? [member.student_id as string] : []);
  const testIds = (tests || []).map((test) => test.id as string);
  if (!studentIds.length || !testIds.length) return Response.json(classProgress(members || [], tests || [], []));
  const { data: attempts, error: attemptError } = await db.from("web_attempts")
    .select("test_id,student_id,percentage,submitted_at").in("test_id", testIds).in("student_id", studentIds)
    .order("submitted_at", { ascending: true }).limit(10000);
  if (attemptError) return jsonError("Could not load results.", 503);
  return Response.json(classProgress(members || [], tests || [], attempts || []));
}
