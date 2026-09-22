import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { shareContext } from "@/lib/share";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, link, test, settings } = context;
  const { data: prior } = await admin.from("web_attempts").select("id")
    .eq("test_id", test.id).eq("student_id", actor.id).maybeSingle();
  if (prior) return jsonError("This test was already submitted.", 409);
  const { data: draft } = await admin.from("web_drafts").select("started_at")
    .eq("link_id", link.id).eq("student_id", actor.id).maybeSingle();
  if (!draft) return jsonError("Open the test before saving answers.", 409);
  if (settings.timer_minutes && Date.now() > Date.parse(draft.started_at) + settings.timer_minutes * 60000) {
    return jsonError("Time is over for this attempt.", 403);
  }
  let body: { answers?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid answers."); }
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers) ||
      JSON.stringify(body.answers).length > 50000) return jsonError("Invalid answers.");
  const allowedIds = new Set(context.variant.questions.map((q) => q.id));
  const answers = Object.fromEntries(Object.entries(body.answers).filter(([id]) => allowedIds.has(id)));
  const savedAt = new Date().toISOString();
  const { error } = await admin.from("web_drafts").update({ answers, updated_at: savedAt })
    .eq("link_id", link.id).eq("student_id", actor.id);
  if (error) return jsonError("Draft could not be saved.", 503);
  return Response.json({ saved_at: savedAt });
}
