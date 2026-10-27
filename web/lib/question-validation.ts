import type { Question, TestVariant } from "./types";

// Pure validation shared by the API and the teacher editor, which shows the
// teacher which question still needs fixing before the server would reject it.

export const QUESTION_TYPES = ["multiple_choice", "true_false", "short_answer", "matching"] as const;

export type QuestionProblem =
  | "invalid"
  | "empty_question"
  | "options_count"
  | "options_empty"
  | "options_duplicate"
  | "correct_missing"
  | "pairs_count"
  | "pairs_empty"
  | "pairs_duplicate"
  | "answer_empty";

const key = (value: string) => value.trim().toLocaleLowerCase();

export function questionProblem(value: unknown): QuestionProblem | null {
  if (!value || typeof value !== "object") return "invalid";
  const question = value as Partial<Question>;
  if (typeof question.id !== "string" || !question.id.trim() || typeof question.question !== "string" ||
    typeof question.correct_answer !== "string" || !(QUESTION_TYPES as readonly string[]).includes(question.type || "") ||
    (question.source_reference !== undefined && (typeof question.source_reference !== "string" || question.source_reference.length > 320))) return "invalid";
  if (!question.question.trim()) return "empty_question";

  if (question.type === "multiple_choice" || question.type === "true_false") {
    if (!Array.isArray(question.options)) return "invalid";
    // Legacy teacher-authored tests may have two or three choices. Reject a
    // one-choice question, but do not invalidate an already published test.
    if (question.options.length < 2) return "options_count";
    if (!question.options.every((option) => typeof option === "string" && Boolean(option.trim()))) return "options_empty";
    const normalizedOptions = question.options.map(key);
    if (new Set(normalizedOptions).size !== question.options.length) return "options_duplicate";
    return normalizedOptions.includes(key(question.correct_answer)) ? null : "correct_missing";
  }

  if (question.type === "matching") {
    if (!Array.isArray(question.pairs) || question.pairs.length < 2) return "pairs_count";
    const left = new Set<string>();
    const right = new Set<string>();
    for (const pair of question.pairs) {
      if (!pair || typeof pair.left !== "string" || typeof pair.right !== "string" || !pair.left.trim() || !pair.right.trim()) return "pairs_empty";
      if (left.has(key(pair.left)) || right.has(key(pair.right))) return "pairs_duplicate";
      left.add(key(pair.left)); right.add(key(pair.right));
    }
    return null;
  }

  return question.correct_answer.trim() ? null : "answer_empty";
}

export function isValidVariant(value: unknown): value is TestVariant {
  if (!value || typeof value !== "object") return false;
  const variant = value as Partial<TestVariant>;
  if (typeof variant.title !== "string" || !variant.title.trim() || !Array.isArray(variant.questions) ||
    variant.questions.length === 0 || variant.questions.length > 50) return false;

  if (variant.sources !== undefined && (!Array.isArray(variant.sources) || variant.sources.length > 8 ||
    !variant.sources.every((source) => {
      if (!source || typeof source !== "object") return false;
      const item = source as { label?: unknown; pages?: unknown; url?: unknown };
      if (typeof item.label !== "string" || !item.label.trim() || item.label.length > 180) return false;
      if (item.pages !== undefined && (typeof item.pages !== "string" || item.pages.length > 120)) return false;
      if (item.url !== undefined) {
        if (typeof item.url !== "string") return false;
        try { if (new URL(item.url).protocol !== "https:") return false; } catch { return false; }
      }
      return true;
    }))) return false;

  const ids = new Set<string>();
  return variant.questions.every((question) => {
    if (questionProblem(question) !== null) return false;
    // Answers and grading are keyed by question id, so ids must be unique.
    if (ids.has(question.id)) return false;
    ids.add(question.id);
    return true;
  });
}
