import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";

// Lets one student take the test again: the submitted attempt and the per-student
// strict/integrity state go away, so the student's next open starts a fresh draft.
// The old score is not kept; the teacher confirms this in the UI first.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id: testId } = await params;
  const db = userClient(actor.accessToken);
  const { data: test, error: testError } = await db.from("web_tests").select("id")
    .eq("id", testId).eq("owner_id", actor.id).maybeSingle();
  if (testError) return jsonError("Could not verify test ownership.", 503);
  if (!test) return jsonError("Test not found.", 404);

  let body: { attempt_id?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request."); }
  if (typeof body.attempt_id !== "string" || !body.attempt_id) return jsonError("Invalid request.");

  const admin = adminClient();
  const { data: attempt, error: attemptError } = await admin.from("web_attempts")
    .select("id,link_id,student_id").eq("id", body.attempt_id).eq("test_id", testId).maybeSingle();
  if (attemptError) return jsonError("Could not load the attempt.", 503);
  if (!attempt) return jsonError("Attempt not found.", 404);

  // Dependent rows first: if one step fails the attempt is still intact. Older
  // databases may lack the strict/integrity tables (42P01), which is fine.
  const scope = { link_id: attempt.link_id, student_id: attempt.student_id };
  for (const table of ["web_strict_question_windows", "web_strict_attempt_state"]) {
    const { error } = await admin.from(table).delete().match(scope);
    if (error && error.code !== "42P01") return jsonError("Could not reset the attempt.", 503);
  }
  const { error: eventsError } = await admin.from("web_attempt_events").delete().match(scope);
  if (eventsError && eventsError.code !== "42P01") return jsonError("Could not reset the attempt.", 503);

  const { error } = await admin.from("web_attempts").delete().eq("id", attempt.id).eq("test_id", testId);
  if (error) return jsonError("Could not reset the attempt.", 503);
  return Response.json({ reset: true });
}
