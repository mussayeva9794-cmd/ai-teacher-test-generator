import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { grade, personalizedVariant } from "@/lib/assessment";
import { leaveLimitReached, loadIntegrity } from "@/lib/integrity-server";
import { shareContext } from "@/lib/share";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  const { token } = await params;
  const context = await shareContext(token, actor);
  if ("error" in context && context.error) return jsonError(context.error, context.status);
  const { admin, link, test, settings, variant } = context;
  const loadDraft = () => admin.from("web_drafts")
    .select("answers,updated_at").eq("link_id", link.id).eq("student_id", actor.id).maybeSingle();
  // The first draft read does not depend on the prior-attempt check; run both at once.
  const [{ data: prior, error: priorError }, firstDraft] = await Promise.all([
    admin.from("web_attempts").select("id,percentage").eq("test_id", test.id).eq("student_id", actor.id).maybeSingle(),
    loadDraft(),
  ]);
  if (priorError) return jsonError("Could not check your submission status.", 503);
  if (prior) return Response.json({ submitted: true, percentage: settings.reveal_score ? prior.percentage : null });
  let body: { answers?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  const ordered = personalizedVariant(variant, token, actor.id, settings.randomize);
  const allowedIds = new Set(ordered.questions.map((q) => q.id));
  const isAnswersObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(value).length <= 50000;
  const integrity = settings.strict_mode ? await loadIntegrity(admin, link.id, actor.id) : null;
  // After too many leaves only the answers saved before locking count.
  const strictLocked = Boolean(integrity && leaveLimitReached(settings, integrity.leaves));
  // Strict answers are persisted one open question at a time by the database
  // RPC. Never accept a complete answer map from the browser at submission.
  const currentAnswers = !settings.strict_mode && isAnswersObject(body.answers) && !strictLocked
    ? Object.fromEntries(Object.entries(body.answers).filter(([id]) => allowedIds.has(id)))
    : null;

  // Retry if an autosave completed between loading the draft and locking it in
  // the finalization RPC. The RPC decides expiry using the database clock.
  for (let retry = 0; retry < 3; retry += 1) {
    const { data: draft, error: draftError } = retry === 0 ? firstDraft : await loadDraft();
    if (draftError) return jsonError("Could not load your draft.", 503);
    if (!draft) return jsonError("Open the test before submitting.", 409);
    if (!isAnswersObject(draft.answers)) return jsonError("The saved draft is invalid.", 503);

    const savedAnswers = Object.fromEntries(Object.entries(draft.answers).filter(([id]) => allowedIds.has(id)));
    // A locked strict attempt, or one whose last question timed out, submits the
    // server-saved draft. The RPC requires current answers while the attempt
    // window itself is still open, so pass the saved draft explicitly.
    const submittedAnswers = settings.strict_mode && (strictLocked || !currentAnswers)
      ? savedAnswers
      : currentAnswers;
    const currentResult = submittedAnswers ? grade(ordered, submittedAnswers) : null;
    const savedResult = grade(ordered, savedAnswers);
    const { data, error } = await admin.rpc("finalize_web_attempt", {
      p_link_id: link.id,
      p_test_id: test.id,
      p_student_id: actor.id,
      p_expected_draft_updated_at: draft.updated_at,
      p_expected_draft_answers: draft.answers,
      p_current_answers: submittedAnswers,
      p_current_percentage: currentResult?.percentage ?? null,
      p_current_result: currentResult,
      p_saved_answers: savedAnswers,
      p_saved_percentage: savedResult.percentage,
      p_saved_result: savedResult,
    });

    if (error?.code === "23505") return jsonError("This account has already submitted this test.", 409);
    if (error) {
      console.error("Atomic attempt finalization failed", error);
      return jsonError("Submission failed. Your draft remains available; please retry.", 503);
    }
    const finalized = data as { status?: string; expired?: boolean; percentage?: number | null } | null;
    if (finalized?.status === "draft_changed") continue;
    if (finalized?.status === "invalid_answers") return jsonError("Invalid answers.");
    if (finalized?.status === "invalid_saved_draft") return jsonError("The saved draft is invalid.", 503);
    if (finalized?.status === "already_submitted") return jsonError("This account has already submitted this test.", 409);
    if (finalized?.status === "missing") return jsonError("Open the test before submitting.", 409);
    if (finalized?.status === "unavailable") return jsonError("This test link is unavailable.", 404);
    if (finalized?.status !== "submitted") return jsonError("Submission failed. Your draft remains available; please retry.", 503);

    await admin.from("web_drafts").delete().eq("link_id", link.id).eq("student_id", actor.id);
    if (strictLocked) {
      const { error: eventError } = await admin.from("web_attempt_events").insert({
        link_id: link.id, test_id: test.id, student_id: actor.id, kind: "auto_submit", question_id: null,
      });
      if (eventError) console.error("Integrity event insert failed", { code: eventError.code });
    }
    return Response.json({
      submitted: true,
      percentage: settings.reveal_score ? finalized.percentage ?? null : null,
      expired: Boolean(finalized.expired),
      locked: strictLocked,
    });
  }

  return jsonError("Answers are still being saved. Please retry submission.", 409);
}
