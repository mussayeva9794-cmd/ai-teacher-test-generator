import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { personalizedVariant, studentVariant } from "@/lib/assessment";
import { attemptWindowExpired, canStartAttempt } from "@/lib/attempt-window";
import { shareContext } from "@/lib/share";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, test, link, settings, variant } = context;
  const { data: prior, error: priorError } = await admin.from("web_attempts").select("id")
    .eq("test_id", test.id).eq("student_id", actor.id).maybeSingle();
  if (priorError) return jsonError("Could not check your submission status.", 503);
  if (prior) return Response.json({ submitted: true, title: test.title });
  let { data: draft, error: loadError } = await admin.from("web_drafts")
    .select("answers,started_at,updated_at").eq("link_id", link.id).eq("student_id", actor.id).maybeSingle();
  if (loadError) return jsonError("Could not load your draft.", 503);
  if (!draft && !canStartAttempt(settings.deadline_at)) {
    return jsonError("The deadline for this test has passed.", 403);
  }
  if (!draft) {
    const { error: draftError } = await admin.from("web_drafts")
      .insert({ link_id: link.id, student_id: actor.id, answers: {} });
    if (draftError && draftError.code !== "23505") return jsonError("Could not start this test.", 503);
    const loaded = await admin.from("web_drafts").select("answers,started_at,updated_at")
      .eq("link_id", link.id).eq("student_id", actor.id).single();
    draft = loaded.data;
    loadError = loaded.error;
  }
  if (loadError || !draft) return jsonError("Could not load your draft.", 503);
  let closesAt = settings.timer_minutes
    ? new Date(Date.parse(draft.started_at) + settings.timer_minutes * 60000).toISOString() : null;
  if (settings.deadline_at && Number.isFinite(Date.parse(settings.deadline_at)) &&
      (!closesAt || Date.parse(settings.deadline_at) < Date.parse(closesAt))) {
    closesAt = settings.deadline_at;
  }
  const expired = attemptWindowExpired(draft.started_at, settings.timer_minutes, settings.deadline_at);
  return Response.json({
    submitted: false, title: test.title, topic: test.topic, variant_name: link.variant_name,
    variant: studentVariant(personalizedVariant(variant, token, actor.id, settings.randomize)),
    settings: { one_question_at_a_time: settings.one_question_at_a_time, reveal_score: settings.reveal_score },
    answers: draft.answers || {}, closes_at: closesAt, saved_at: draft.updated_at, expired,
  });
}
