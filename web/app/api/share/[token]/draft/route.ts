import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { shareContext } from "@/lib/share";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, link, test } = context;
  const { data: prior, error: priorError } = await admin.from("web_attempts").select("id")
    .eq("test_id", test.id).eq("student_id", actor.id).maybeSingle();
  if (priorError) return jsonError("Could not check your submission status.", 503);
  if (prior) return jsonError("This test was already submitted.", 409);
  let body: { answers?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid answers."); }
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers) ||
      JSON.stringify(body.answers).length > 50000) return jsonError("Invalid answers.");
  const allowedIds = new Set(context.variant.questions.map((q) => q.id));
  const answers = Object.fromEntries(Object.entries(body.answers).filter(([id]) => allowedIds.has(id)));
  const { data: status, error } = await admin.rpc("save_web_draft_if_open", {
    p_link_id: link.id,
    p_test_id: test.id,
    p_student_id: actor.id,
    p_answers: answers,
  });
  if (error) {
    console.error("Atomic draft save failed", error);
    return jsonError("Draft could not be saved. Please retry.", 503);
  }
  if (status === "saved") return Response.json({ saved_at: new Date().toISOString() });
  if (status === "expired") return jsonError("The attempt window has ended; the last saved draft was kept.", 403);
  if (status === "submitted") return jsonError("This test was already submitted.", 409);
  if (status === "missing") return jsonError("Open the test before saving answers.", 409);
  if (status === "unavailable") return jsonError("This test link is unavailable.", 404);
  if (status === "invalid") return jsonError("Invalid answers.");
  return jsonError("Draft could not be saved. Please retry.", 503);
}
