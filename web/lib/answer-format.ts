import type { Question } from "./types";

/** A student answer of any question type as one line of text. */
export function answerText(question: Question, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (question.type === "matching" && typeof value === "object" && !Array.isArray(value)) {
    const given = value as Record<string, unknown>;
    return (question.pairs || []).map((pair) => `${pair.left} → ${String(given[pair.left] ?? "—") || "—"}`).join("; ");
  }
  if (Array.isArray(value)) return value.map(String).join(question.type === "ordering" ? " → " : "; ");
  return String(value);
}

/** The correct answer of any question type as one line of text. */
export function correctText(question: Question): string {
  if (question.type === "matching") return (question.pairs || []).map((pair) => `${pair.left} → ${pair.right}`).join("; ");
  if (question.type === "multiple_select") return (question.correct_answers || []).join("; ");
  if (question.type === "ordering") return (question.items || []).join(" → ");
  return question.correct_answer;
}
