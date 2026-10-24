import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { leaveLimitReached, loadIntegrity, MAX_EVENTS_PER_ATTEMPT, parseClientEvent } from "@/lib/integrity-server";
import { shareContext } from "@/lib/share";
import { finalizeLockedAttempt } from "@/lib/strict-finalize";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, link, test, settings, variant } = context;
  if (!settings.strict_mode) return jsonError("Strict mode is not enabled for this link.", 409);

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid event."); }
  const event = parseClientEvent(body, new Set(variant.questions.map((question) => question.id)));
  if (!event) return jsonError("Invalid event.");

  // Independent reads run in parallel: each database round trip is felt by the
  // student as a delay before the leave counter updates.
  const [{ data: prior, error: priorError }, before] = await Promise.all([
    admin.from("web_attempts").select("id").eq("test_id", test.id).eq("student_id", actor.id).maybeSingle(),
    loadIntegrity(admin, link.id, actor.id),
  ]);
  if (priorError) return jsonError("Could not check your submission status.", 503);
  if (prior) return jsonError("This test was already submitted.", 409);
  if (!before) return jsonError("Could not record the event.", 503);
  if (before.events >= MAX_EVENTS_PER_ATTEMPT) return jsonError("Too many events for this attempt.", 429);
  // Only the first display of a question starts its per-question timer.
  const duplicateStart = event.kind === "question_shown" && Boolean(before.question_started[event.question_id!]);
  let after = before;
  if (!duplicateStart) {
    const { data: inserted, error } = await admin.from("web_attempt_events").insert({
      link_id: link.id, test_id: test.id, student_id: actor.id, kind: event.kind, question_id: event.question_id,
    }).select("created_at").single();
    if (error || !inserted) {
      console.error("Integrity event insert failed", { code: error?.code });
      return jsonError("Could not record the event.", 503);
    }
    after = {
      ...before,
      events: before.events + 1,
      leaves: before.leaves + (event.kind === "leave" ? 1 : 0),
      pastes: before.pastes + (event.kind === "paste" ? 1 : 0),
      copies: before.copies + (event.kind === "copy" ? 1 : 0),
      question_started: event.kind === "question_shown"
        ? { ...before.question_started, [event.question_id!]: inserted.created_at as string }
        : before.question_started,
    };
  }
  const locked = leaveLimitReached(settings, after.leaves);
  // Submit on the server right away; the client may never get to do it.
  const finalized = locked && event.kind === "leave"
    ? await finalizeLockedAttempt(admin, { linkId: link.id, testId: test.id, studentId: actor.id, token, variant, settings })
    : null;
  return Response.json({
    leaves: after.leaves,
    locked,
    submitted: finalized === "submitted" || finalized === "already_submitted",
    question_started: after.question_started,
    server_now: new Date().toISOString(),
  });
}
