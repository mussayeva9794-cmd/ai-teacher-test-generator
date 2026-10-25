import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { personalizedVariant, studentVariant } from "@/lib/assessment";
import { shareContext } from "@/lib/share";

/** Advance a strict attempt. The browser never selects the next question. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, link, test, settings, variant } = context;
  if (!settings.strict_mode) return jsonError("Strict mode is not enabled for this link.", 409);

  const { data, error } = await admin.rpc("advance_web_strict_question", {
    p_link_id: link.id,
    p_test_id: test.id,
    p_student_id: actor.id,
  });
  if (error) {
    console.error("Strict question advance failed", { code: error.code });
    return jsonError("Could not advance the question. Please retry.", 503);
  }
  const progress = data as {
    status?: string; current_index?: number; question_started_at?: string; server_now?: string;
  } | null;
  if (progress?.status === "submitted") return jsonError("This test was already submitted.", 409);
  if (progress?.status === "expired") return Response.json({ expired: true });
  if (progress?.status === "not_ready") return Response.json({
    ready: false,
    current_index: progress.current_index,
    question_started_at: progress.question_started_at,
    server_now: progress.server_now,
  });
  if (progress?.status === "finished") return Response.json({ finished: true, server_now: progress.server_now });
  const currentIndex = progress?.current_index;
  if (progress?.status !== "advanced" || typeof currentIndex !== "number" || !Number.isInteger(currentIndex) ||
      typeof progress.question_started_at !== "string") {
    return jsonError("Could not advance the question. Please retry.", 503);
  }
  const ordered = personalizedVariant(variant, token, actor.id, settings.randomize);
  const question = studentVariant({ ...ordered, questions: [ordered.questions[currentIndex]] }).questions[0];
  if (!question) return jsonError("Could not load the next question.", 503);
  return Response.json({
    ready: true,
    current_index: currentIndex,
    question_started_at: progress.question_started_at,
    server_now: progress.server_now,
    question,
  });
}
