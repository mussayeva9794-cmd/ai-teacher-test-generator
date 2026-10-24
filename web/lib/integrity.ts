import type { ShareSettings } from "./types";

// Strict-mode signals. They deter and flag same-device AI use; they are not
// proof of cheating and cannot see a second device.
export const CLIENT_EVENT_KINDS = ["leave", "return", "paste", "copy", "question_shown"] as const;
export type ClientEventKind = typeof CLIENT_EVENT_KINDS[number];
export type IntegrityEventKind = ClientEventKind | "auto_submit";

export const MAX_EVENTS_PER_ATTEMPT = 1000;
// Network slack before a closed question stops accepting answer changes.
export const QUESTION_GRACE_MS = 5000;

export type IntegrityEvent = { kind: string; question_id: string | null; created_at: string };

export type IntegritySummary = {
  events: number;
  leaves: number;
  pastes: number;
  copies: number;
  question_started: Record<string, string>;
};

export function parseClientEvent(
  value: unknown,
  questionIds: ReadonlySet<string>,
): { kind: ClientEventKind; question_id: string | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as { kind?: unknown; question_id?: unknown };
  if (typeof body.kind !== "string" || !(CLIENT_EVENT_KINDS as readonly string[]).includes(body.kind)) return null;
  const kind = body.kind as ClientEventKind;
  if (kind === "question_shown") {
    if (typeof body.question_id !== "string" || !questionIds.has(body.question_id)) return null;
    return { kind, question_id: body.question_id };
  }
  return { kind, question_id: null };
}

export function summarizeIntegrity(events: readonly IntegrityEvent[]): IntegritySummary {
  const summary: IntegritySummary = { events: events.length, leaves: 0, pastes: 0, copies: 0, question_started: {} };
  for (const event of events) {
    if (event.kind === "leave") summary.leaves += 1;
    else if (event.kind === "paste") summary.pastes += 1;
    else if (event.kind === "copy") summary.copies += 1;
    else if (event.kind === "question_shown" && event.question_id) {
      const known = summary.question_started[event.question_id];
      if (!known || Date.parse(event.created_at) < Date.parse(known)) summary.question_started[event.question_id] = event.created_at;
    }
  }
  return summary;
}

/** True once the student has left the page more often than the teacher allows. */
export function leaveLimitReached(settings: Pick<ShareSettings, "strict_mode" | "leave_limit">, leaves: number): boolean {
  return settings.strict_mode && settings.leave_limit !== null && leaves > settings.leave_limit;
}

export function questionWindowClosed(startedAt: string | undefined, seconds: number, now: number, graceMs = 0): boolean {
  if (seconds <= 0 || !startedAt) return false;
  const start = Date.parse(startedAt);
  return Number.isFinite(start) && now >= start + seconds * 1000 + graceMs;
}

/**
 * Keep answer changes only for questions that were shown and are still inside
 * their per-question window; everything else keeps its previously saved value.
 */
export function enforceQuestionWindows(
  next: Record<string, unknown>,
  previous: Record<string, unknown>,
  questionStarted: Record<string, string>,
  seconds: number,
  now: number,
): Record<string, unknown> {
  if (seconds <= 0) return next;
  const result: Record<string, unknown> = {};
  for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const open = Boolean(questionStarted[id]) && !questionWindowClosed(questionStarted[id], seconds, now, QUESTION_GRACE_MS);
    const value = open ? next[id] : previous[id];
    if (value !== undefined) result[id] = value;
  }
  return result;
}
