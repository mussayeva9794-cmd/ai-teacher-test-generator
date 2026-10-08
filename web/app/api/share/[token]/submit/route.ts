import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { grade, personalizedVariant } from "@/lib/assessment";
import { attemptWindowExpired } from "@/lib/attempt-window";
import { shareContext } from "@/lib/share";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, link, test, settings, variant } = context;
  const { data: prior, error: priorError } = await admin.from("web_attempts").select("id,percentage")
    .eq("test_id", test.id).eq("student_id", actor.id).maybeSingle();
  if (priorError) return jsonError("Could not check your submission status.", 503);
  if (prior) return Response.json({ submitted: true, percentage: settings.reveal_score ? prior.percentage : null });
  const { data: draft, error: draftError } = await admin.from("web_drafts").select("started_at,answers")
    .eq("link_id", link.id).eq("student_id", actor.id).maybeSingle();
  if (draftError) return jsonError("Could not load your draft.", 503);
  if (!draft) return jsonError("Open the test before submitting.", 409);
  let body: { answers?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  // A request body can finish arriving after the timer or deadline expires.
  let expired = attemptWindowExpired(draft.started_at, settings.timer_minutes, settings.deadline_at);
  if (!expired && (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers) ||
      JSON.stringify(body.answers).length > 50000)) return jsonError("Invalid answers.");
  const ordered = personalizedVariant(variant, token, actor.id, settings.randomize);
  const allowedIds = new Set(ordered.questions.map((q) => q.id));
  // After expiry, only the last server-persisted draft is eligible for auto-submission.
  let sourceAnswers = expired ? draft.answers : body.answers;
  if (!sourceAnswers || typeof sourceAnswers !== "object" || Array.isArray(sourceAnswers)) {
    return jsonError("The saved draft is invalid.", 503);
  }
  let answers = Object.fromEntries(Object.entries(sourceAnswers).filter(([id]) => allowedIds.has(id)));
  let result = grade(ordered, answers);
  // Grading can also cross the deadline; never insert newly supplied answers then.
  if (!expired && attemptWindowExpired(draft.started_at, settings.timer_minutes, settings.deadline_at)) {
    expired = true;
    sourceAnswers = draft.answers;
    if (!sourceAnswers || typeof sourceAnswers !== "object" || Array.isArray(sourceAnswers)) {
      return jsonError("The saved draft is invalid.", 503);
    }
    answers = Object.fromEntries(Object.entries(sourceAnswers).filter(([id]) => allowedIds.has(id)));
    result = grade(ordered, answers);
  }
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
  return Response.json({ submitted: true, percentage: settings.reveal_score ? result.percentage : null, expired });
}
