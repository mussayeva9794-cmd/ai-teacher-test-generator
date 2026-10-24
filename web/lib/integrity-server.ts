import type { adminClient } from "./supabase-admin";
import { MAX_EVENTS_PER_ATTEMPT, summarizeIntegrity, type IntegrityEvent, type IntegritySummary } from "./integrity";

export { enforceQuestionWindows, leaveLimitReached, MAX_EVENTS_PER_ATTEMPT, parseClientEvent } from "./integrity";

type Admin = ReturnType<typeof adminClient>;

/**
 * Load one student's strict-mode events for a link. Callers fail open on error:
 * these are deterrence signals, so a logging outage must not block an exam.
 */
export async function loadIntegrity(admin: Admin, linkId: string, studentId: string): Promise<IntegritySummary | null> {
  const { data, error } = await admin.from("web_attempt_events")
    .select("kind,question_id,created_at").eq("link_id", linkId).eq("student_id", studentId)
    .order("created_at", { ascending: true }).limit(MAX_EVENTS_PER_ATTEMPT);
  if (error) {
    console.error("Integrity events load failed", { code: error.code });
    return null;
  }
  return summarizeIntegrity((data || []) as IntegrityEvent[]);
}
