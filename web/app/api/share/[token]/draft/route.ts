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
  // Both save RPCs check for a submitted attempt under the same lock as the write.
  let body: { answers?: unknown; question_id?: unknown; answer?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid answers."); }
  const { settings } = context;
  if (settings.strict_mode) {
    if (typeof body.question_id !== "string" || !body.question_id || body.question_id.length > 100 ||
        !Object.prototype.hasOwnProperty.call(body, "answer") || JSON.stringify(body.answer).length > 20000) {
      return jsonError("Invalid strict answer.");
    }
    const { data, error } = await admin.rpc("save_web_strict_answer_if_open", {
      p_link_id: link.id,
      p_test_id: test.id,
      p_student_id: actor.id,
      p_question_id: body.question_id,
      p_answer: body.answer,
    });
    if (error) {
      console.error("Strict draft save failed", { code: error.code });
      return jsonError("Draft could not be saved. Please retry.", 503);
    }
    const saved = data as { status?: string; saved_at?: string } | null;
    if (saved?.status === "saved") return Response.json({ saved_at: saved.saved_at || new Date().toISOString() });
    if (saved?.status === "question_expired" || saved?.status === "finished") {
      return jsonError("This question is no longer open; the last saved answer was kept.", 403);
    }
    if (saved?.status === "wrong_question") return jsonError("This question is not currently open.", 409);
    if (saved?.status === "expired") return jsonError("The attempt window has ended; the last saved draft was kept.", 403);
    if (saved?.status === "submitted") return jsonError("This test was already submitted.", 409);
    if (saved?.status === "missing") return jsonError("Open the test before saving answers.", 409);
    if (saved?.status === "unavailable") return jsonError("This test link is unavailable.", 404);
    return jsonError("Draft could not be saved. Please retry.", 503);
  }
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
