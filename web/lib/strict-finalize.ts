import { grade, personalizedVariant } from "./assessment";
import type { adminClient } from "./supabase-admin";
import type { ShareSettings, TestVariant } from "./types";

type Admin = ReturnType<typeof adminClient>;

/**
 * Submit a strict attempt from its server-saved draft the moment the leave
 * limit is exceeded, so it does not depend on the student coming back: a
 * phone may freeze or discard the backgrounded tab, or the student may close it.
 */
export async function finalizeLockedAttempt(admin: Admin, args: {
  linkId: string; testId: string; studentId: string; token: string; variant: TestVariant; settings: ShareSettings;
}): Promise<"submitted" | "already_submitted" | "no_draft" | "failed"> {
  const ordered = personalizedVariant(args.variant, args.token, args.studentId, args.settings.randomize);
  const allowedIds = new Set(ordered.questions.map((question) => question.id));
  for (let retry = 0; retry < 3; retry += 1) {
    const { data: draft, error: draftError } = await admin.from("web_drafts")
      .select("answers,updated_at").eq("link_id", args.linkId).eq("student_id", args.studentId).maybeSingle();
    if (draftError) return "failed";
    if (!draft) return "no_draft";
    if (!draft.answers || typeof draft.answers !== "object" || Array.isArray(draft.answers)) return "failed";
    const savedAnswers = Object.fromEntries(Object.entries(draft.answers as Record<string, unknown>).filter(([id]) => allowedIds.has(id)));
    const result = grade(ordered, savedAnswers);
    const { data, error } = await admin.rpc("finalize_web_attempt", {
      p_link_id: args.linkId,
      p_test_id: args.testId,
      p_student_id: args.studentId,
      p_expected_draft_updated_at: draft.updated_at,
      p_expected_draft_answers: draft.answers,
      p_current_answers: savedAnswers,
      p_current_percentage: result.percentage,
      p_current_result: result,
      p_saved_answers: savedAnswers,
      p_saved_percentage: result.percentage,
      p_saved_result: result,
    });
    if (error?.code === "23505") return "already_submitted";
    if (error) {
      console.error("Locked attempt finalization failed", { code: error.code });
      return "failed";
    }
    const status = (data as { status?: string } | null)?.status;
    if (status === "draft_changed") continue;
    if (status === "already_submitted") return "already_submitted";
    if (status !== "submitted") return "failed";
    await admin.from("web_drafts").delete().eq("link_id", args.linkId).eq("student_id", args.studentId);
    const { error: eventError } = await admin.from("web_attempt_events").insert({
      link_id: args.linkId, test_id: args.testId, student_id: args.studentId, kind: "auto_submit", question_id: null,
    });
    if (eventError) console.error("Integrity event insert failed", { code: eventError.code });
    return "submitted";
  }
  return "failed";
}
