import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { answerReview, personalizedVariant, studentVariant } from "@/lib/assessment";
import { attemptWindowExpired } from "@/lib/attempt-window";
import { leaveLimitReached, loadIntegrity } from "@/lib/integrity-server";
import { shareContext } from "@/lib/share";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, test, link, settings, variant } = context;
  const { data: prior, error: priorError } = await admin.from("web_attempts").select("id,percentage,answers,result")
    .eq("test_id", test.id).eq("student_id", actor.id).maybeSingle();
  if (priorError) return jsonError("Could not check your submission status.", 503);
  if (prior) return Response.json({
    submitted: true,
    title: test.title,
    percentage: settings.reveal_score ? prior.percentage : null,
    ...(settings.reveal_answers ? {
      review: answerReview(personalizedVariant(variant, token, actor.id, settings.randomize), (prior.answers || {}) as Record<string, unknown>, prior.result),
    } : {}),
  });
  let { data: draft, error: loadError } = await admin.from("web_drafts")
    .select("answers,started_at,updated_at").eq("link_id", link.id).eq("student_id", actor.id).maybeSingle();
  if (loadError) return jsonError("Could not load your draft.", 503);
  // A browser that can go full screen asks first, so the attempt clock and the
  // first question's clock start only once the student is in full screen.
  if (!draft && settings.strict_mode && settings.require_fullscreen &&
      request.nextUrl.searchParams.get("start") === "after_fullscreen") {
    return Response.json({
      submitted: false, awaiting_fullscreen: true, title: test.title, topic: test.topic, variant_name: link.variant_name,
      server_now: new Date().toISOString(),
    });
  }
  if (!draft) {
    const { data: startStatus, error: startError } = await admin.rpc("start_web_draft_if_open", {
      p_link_id: link.id,
      p_test_id: test.id,
      p_student_id: actor.id,
    });
    if (startError) {
      console.error("Atomic attempt start failed", startError);
      return jsonError("Could not start this test. Please retry.", 503);
    }
    if (startStatus === "expired") return jsonError("The deadline for this test has passed.", 403);
    if (startStatus === "submitted") return jsonError("This test was already submitted.", 409);
    if (startStatus === "unavailable") return jsonError("This test link is unavailable.", 404);
    if (startStatus !== "started" && startStatus !== "existing") {
      return jsonError("Could not start this test. Please retry.", 503);
    }
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
  const ordered = personalizedVariant(variant, token, actor.id, settings.randomize);
  const student = studentVariant(ordered);
  const integrity = settings.strict_mode ? await loadIntegrity(admin, link.id, actor.id) : null;
  let deliveredVariant = student;
  let strictProgress: { current_index: number; question_started_at: string; finished: boolean } | null = null;
  if (settings.strict_mode) {
    const { data: state, error: stateError } = await admin.rpc("start_or_load_web_strict_attempt", {
      p_link_id: link.id,
      p_test_id: test.id,
      p_student_id: actor.id,
      p_question_ids: ordered.questions.map((question) => question.id),
    });
    if (stateError) {
      console.error("Strict attempt state failed", { code: stateError.code });
      return jsonError("Could not open the strict test. Please retry.", 503);
    }
    const progress = state as { status?: string; current_index?: number; question_started_at?: string; finished?: boolean } | null;
    const currentIndex = progress?.current_index;
    if (progress?.status === "submitted") return jsonError("This test was already submitted.", 409);
    if (progress?.status !== "ready" || typeof currentIndex !== "number" || !Number.isInteger(currentIndex) ||
        typeof progress.question_started_at !== "string") {
      return jsonError("Could not open the strict test. Please retry.", 503);
    }
    strictProgress = {
      current_index: currentIndex,
      question_started_at: progress.question_started_at,
      finished: Boolean(progress.finished),
    };
    const currentQuestion = student.questions[currentIndex];
    deliveredVariant = {
      ...student,
      // Future questions never leave the server in strict mode.
      questions: currentQuestion && !progress.finished ? [currentQuestion] : [],
    };
  }
  return Response.json({
    submitted: false, title: test.title, topic: test.topic, variant_name: link.variant_name,
    variant: deliveredVariant,
    settings: {
      one_question_at_a_time: settings.one_question_at_a_time, reveal_score: settings.reveal_score,
      strict_mode: settings.strict_mode, leave_limit: settings.leave_limit, question_seconds: settings.question_seconds,
      require_fullscreen: settings.require_fullscreen,
    },
    answers: draft.answers || {}, closes_at: closesAt, saved_at: draft.updated_at, expired,
    ...(strictProgress ? { question_count: student.questions.length, strict_progress: strictProgress } : {}),
    ...(settings.strict_mode ? {
      // Rendered as a watermark so a leaked screenshot identifies its source.
      student_label: [actor.name, actor.email].filter(Boolean).join(" · "),
      integrity: {
        leaves: integrity?.leaves ?? 0,
        locked: leaveLimitReached(settings, integrity?.leaves ?? 0),
        question_started: integrity?.question_started ?? {},
      },
    } : {}),
    server_now: new Date().toISOString(),
  });
}
