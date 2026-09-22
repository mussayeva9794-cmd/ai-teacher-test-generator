import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { grade, personalizedVariant } from "@/lib/assessment";
import { shareContext } from "@/lib/share";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, link, test, settings, variant } = context;
  const { data: draft } = await admin.from("web_drafts").select("started_at")
    .eq("link_id", link.id).eq("student_id", actor.id).maybeSingle();
  if (!draft) return jsonError("Open the test before submitting.", 409);
  if (settings.timer_minutes && Date.now() > Date.parse(draft.started_at) + settings.timer_minutes * 60000) {
    return jsonError("Time is over for this attempt.", 403);
  }
  let body: { answers?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid answers."); }
  if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers) ||
      JSON.stringify(body.answers).length > 50000) return jsonError("Invalid answers.");
  const ordered = personalizedVariant(variant, token, actor.id, settings.randomize);
  const allowedIds = new Set(ordered.questions.map((q) => q.id));
  const answers = Object.fromEntries(Object.entries(body.answers).filter(([id]) => allowedIds.has(id)));
  const result = grade(ordered, answers);
  const { error } = await admin.from("web_attempts").insert({
    test_id: test.id, link_id: link.id, student_id: actor.id,
    variant_name: link.variant_name, answers, percentage: result.percentage, result,
  });
  if (error?.code === "23505") return jsonError("This account has already submitted this test.", 409);
  if (error) {
    console.error("Attempt insert failed", error);
    return jsonError("Submission failed. Your draft remains available; please retry.", 503);
  }
  await admin.from("web_drafts").delete().eq("link_id", link.id).eq("student_id", actor.id);
  return Response.json({ submitted: true, percentage: settings.reveal_score ? result.percentage : null });
}
