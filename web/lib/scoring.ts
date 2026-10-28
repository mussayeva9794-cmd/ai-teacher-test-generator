import type { Question } from "./types";

// Per-question scoring shared by the server grader, the student review and
// the class analytics.

export function normalized(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function questionScore(question: Question, answer: unknown): number {
  if (question.type === "multiple_select") {
    const correct = new Set((question.correct_answers || []).map(normalized));
    if (!Array.isArray(answer) || !correct.size) return 0;
    const chosen = new Set(answer.map(normalized));
    const incorrect = (question.options || []).length - correct.size;
    let hits = 0; let wrong = 0;
    for (const item of chosen) if (correct.has(item)) hits += 1; else wrong += 1;
    // Right ticks earn their share of the correct options and wrong ticks cost
    // their share of the wrong ones, so ticking everything always scores 0.
    return Math.max(0, hits / correct.size - (incorrect > 0 ? wrong / incorrect : wrong));
  }
  if (question.type === "ordering") {
    if (!Array.isArray(answer) || !question.items?.length) return 0;
    return question.items.filter((item, i) => normalized(answer[i]) === normalized(item)).length / question.items.length;
  }
  if (question.type === "matching") {
    if (!answer || typeof answer !== "object" || !question.pairs?.length) return 0;
    const given = answer as Record<string, string>;
    return question.pairs.filter((pair) => normalized(given[pair.left]) === normalized(pair.right)).length / question.pairs.length;
  }
  if (question.type === "short_answer") {
    const expected = normalized(question.correct_answer);
    const student = normalized(answer);
    return student && expected && student === expected ? 1 : 0;
  }
  return normalized(answer) === normalized(question.correct_answer) ? 1 : 0;
}

/** A written answer that is not an exact match: only the teacher can score it. */
export function needsTeacher(question: Question, answer: unknown): boolean {
  return question.type === "short_answer" && typeof answer === "string" && Boolean(answer.trim()) &&
    normalized(answer) !== normalized(question.correct_answer);
}

type StoredRow = { score?: number | null; auto_score?: number; requires_manual_review?: boolean } | undefined;

/**
 * The score to show for one answer. A teacher's manual review clears every
 * per-question score and keeps the grader's auto_score; reviews saved before
 * that are scored again here. Open answers that needed the teacher stay null.
 */
export function shownScore(question: Question, answer: unknown, stored: StoredRow): number | null {
  if (stored?.requires_manual_review) return null;
  if (typeof stored?.score === "number") return stored.score;
  if (typeof stored?.auto_score === "number") return stored.auto_score;
  // Reviews saved before auto_score existed: score again with the current key.
  return needsTeacher(question, answer) ? null : questionScore(question, answer);
}
