import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id: testId } = await params;
  const db = userClient(actor.accessToken);
  const { data: test, error: testError } = await db.from("web_tests").select("id")
    .eq("id", testId).eq("owner_id", actor.id).maybeSingle();
  if (testError) return jsonError("Could not verify test ownership.", 503);
  if (!test) return jsonError("Test not found.", 404);

  let body: { attempt_id?: unknown; percentage?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid review data."); }
  const percentage = body.percentage;
  if (typeof body.attempt_id !== "string" || !body.attempt_id ||
      typeof percentage !== "number" || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return jsonError("Enter a score between 0 and 100.");
  }

  const admin = adminClient();
  const { data: attempt, error: attemptError } = await admin.from("web_attempts")
    .select("id,result").eq("id", body.attempt_id).eq("test_id", testId).maybeSingle();
  if (attemptError) return jsonError("Could not load attempt for review.", 503);
  if (!attempt) return jsonError("Attempt not found.", 404);
  const result = attempt.result && typeof attempt.result === "object"
    ? attempt.result as Record<string, unknown> : {};
  if (result.requires_manual_review !== true) return jsonError("This attempt does not require manual review.", 409);
  const perQuestion = Array.isArray(result.per_question)
    ? result.per_question.map((item) => item && typeof item === "object"
      ? { ...(item as Record<string, unknown>), score: null, requires_manual_review: false }
      : item)
    : [];

  const { error } = await admin.from("web_attempts").update({
    percentage,
    result: { ...result, total_score: null, per_question: perQuestion, per_question_scoring: "unscored", requires_manual_review: false, manually_reviewed_by: actor.id, manually_reviewed_at: new Date().toISOString() },
  }).eq("id", attempt.id).eq("test_id", testId);
  if (error) return jsonError("Could not save the reviewed score.", 503);
  return Response.json({ reviewed: true, percentage });
}
