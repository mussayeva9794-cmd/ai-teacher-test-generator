import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { parseClientEvent } from "@/lib/integrity-server";
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
  // Question visibility is not a browser event: the strict-state RPC owns it.
  if (event.kind === "question_shown") return jsonError("Question progression is server-controlled.", 409);
  const { data, error } = await admin.rpc("record_web_strict_event", {
    p_link_id: link.id,
    p_test_id: test.id,
    p_student_id: actor.id,
    p_kind: event.kind,
  });
  if (error) {
    console.error("Integrity event insert failed", { code: error.code });
    return jsonError("Could not record the event.", 503);
  }
  const recorded = data as { status?: string; leaves?: number; locked?: boolean } | null;
  if (recorded?.status === "submitted") return jsonError("This test was already submitted.", 409);
  if (recorded?.status === "missing") return jsonError("Open the test before recording events.", 409);
  if (recorded?.status === "rate_limited") return jsonError("Too many events for this attempt.", 429);
  if (recorded?.status !== "recorded") return jsonError("Could not record the event.", 503);
  const locked = Boolean(recorded.locked);
  // Submit on the server right away; the client may never get to do it.
  const finalized = locked && event.kind === "leave"
    ? await finalizeLockedAttempt(admin, { linkId: link.id, testId: test.id, studentId: actor.id, token, variant, settings })
    : null;
  return Response.json({
    leaves: recorded.leaves || 0,
    locked,
    submitted: finalized === "submitted" || finalized === "already_submitted",
    server_now: new Date().toISOString(),
  });
}
