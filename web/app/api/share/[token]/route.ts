import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { personalizedVariant, studentVariant } from "@/lib/assessment";
import { shareContext } from "@/lib/share";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, test, link, settings, variant } = context;
  const { data: prior } = await admin.from("web_attempts").select("id")
    .eq("test_id", test.id).eq("student_id", actor.id).maybeSingle();
  if (prior) return Response.json({ submitted: true, title: test.title });
  const { error: draftError } = await admin.from("web_drafts")
    .insert({ link_id: link.id, student_id: actor.id, answers: {} });
  if (draftError && draftError.code !== "23505") return jsonError("Could not start this test.", 503);
  const { data: draft } = await admin.from("web_drafts")
    .select("answers,started_at,updated_at").eq("link_id", link.id).eq("student_id", actor.id).single();
  if (!draft) return jsonError("Could not load your draft.", 503);
  const closesAt = settings.timer_minutes
    ? new Date(Date.parse(draft.started_at) + settings.timer_minutes * 60000).toISOString() : null;
  if (closesAt && Date.now() > Date.parse(closesAt)) return jsonError("Time is over for this attempt.", 403);
  return Response.json({
    submitted: false, title: test.title, topic: test.topic, variant_name: link.variant_name,
    variant: studentVariant(personalizedVariant(variant, token, actor.id, settings.randomize)),
    settings: { one_question_at_a_time: settings.one_question_at_a_time, reveal_score: settings.reveal_score },
    answers: draft.answers || {}, closes_at: closesAt, saved_at: draft.updated_at,
  });
}
