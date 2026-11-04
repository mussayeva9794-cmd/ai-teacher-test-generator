import type { Question, TestVariant, WrittenType } from "./types";
import { DICTATION_MODES, isValidNorms, MAX_REFERENCE_LENGTH, tokenize } from "./dictation";

// Pure validation shared by the API and the teacher editor, which shows the
// teacher which question still needs fixing before the server would reject it.

export const BLOOM_LEVELS = ["knowledge", "understanding", "application", "higher"] as const;

// The types AI can write. Written works are only ever set by the teacher.
export const QUESTION_TYPES = ["multiple_choice", "multiple_select", "true_false", "short_answer", "matching", "ordering"] as const;
export const WRITTEN_TYPES = ["dictation", "essay"] as const satisfies readonly WrittenType[];

export const isWrittenType = (type: unknown): type is WrittenType => (WRITTEN_TYPES as readonly unknown[]).includes(type);

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
  | "answer_empty"
  | "correct_answers_missing"
  | "correct_answers_all"
  | "items_count"
  | "items_empty"
  | "items_duplicate"
  | "reference_empty"
  | "reference_long"
  | "norms_invalid"
  | "criteria_invalid";

const key = (value: string) => value.trim().toLocaleLowerCase();

export function questionProblem(value: unknown): QuestionProblem | null {
  if (!value || typeof value !== "object") return "invalid";
  const question = value as Partial<Question>;
  if (typeof question.id !== "string" || !question.id.trim() || typeof question.question !== "string" ||
    typeof question.correct_answer !== "string" || !((QUESTION_TYPES as readonly string[]).includes(question.type || "") || isWrittenType(question.type)) ||
    (question.source_reference !== undefined && (typeof question.source_reference !== "string" || question.source_reference.length > 320)) ||
    (question.bloom_level !== undefined && !(BLOOM_LEVELS as readonly string[]).includes(question.bloom_level))) return "invalid";
  if (!question.question.trim()) return "empty_question";

  if (question.type === "dictation") {
    if (!(DICTATION_MODES as readonly unknown[]).includes(question.dictation_mode)) return "invalid";
    if (question.correct_answer.length > MAX_REFERENCE_LENGTH) return "reference_long";
    if (!tokenize(question.correct_answer, question.dictation_mode!).some(token => token.kind === "word")) return "reference_empty";
    return question.grade_norms === undefined || isValidNorms(question.grade_norms) ? null : "norms_invalid";
  }

  if (question.type === "essay") {
    if (question.min_words !== undefined && (!Number.isInteger(question.min_words) || question.min_words < 0 || question.min_words > 3000)) return "invalid";
    if (question.correct_answer.length > MAX_REFERENCE_LENGTH) return "reference_long";
    const criteria = question.criteria;
    return Array.isArray(criteria) && criteria.length >= 1 && criteria.length <= 10 && criteria.every(item =>
      item && typeof item.name === "string" && Boolean(item.name.trim()) && item.name.length <= 200 &&
      Number.isInteger(item.points) && item.points >= 1 && item.points <= 20) ? null : "criteria_invalid";
  }

  if (question.type === "multiple_select") {
    if (!Array.isArray(question.options)) return "invalid";
    if (question.options.length < 3) return "options_count";
    if (!question.options.every((option) => typeof option === "string" && Boolean(option.trim()))) return "options_empty";
    const normalizedOptions = question.options.map(key);
    if (new Set(normalizedOptions).size !== question.options.length) return "options_duplicate";
    if (!Array.isArray(question.correct_answers) || !question.correct_answers.every((answer) => typeof answer === "string")) return "invalid";
    const correct = question.correct_answers.map(key);
    if (!correct.length || new Set(correct).size !== correct.length || !correct.every((answer) => normalizedOptions.includes(answer))) return "correct_answers_missing";
    // With every option correct, ticking everything would score full marks.
    return correct.length < question.options.length ? null : "correct_answers_all";
  }

  if (question.type === "ordering") {
    if (!Array.isArray(question.items) || question.items.length < 3 || question.items.length > 10) return "items_count";
    if (!question.items.every((item) => typeof item === "string" && Boolean(item.trim()))) return "items_empty";
    return new Set(question.items.map(key)).size === question.items.length ? null : "items_duplicate";
  }

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

  if (variant.source_text !== undefined && (typeof variant.source_text !== "string" || variant.source_text.length > 12000)) return false;
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

  if (variant.assessment !== undefined && !isValidAssessment(variant.assessment)) return false;

  const ids = new Set<string>();
  return variant.questions.every((question) => {
    if (questionProblem(question) !== null) return false;
    // Answers and grading are keyed by question id, so ids must be unique.
    if (ids.has(question.id)) return false;
    ids.add(question.id);
    return true;
  });
}

function isValidAssessment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const assessment = value as { kind?: unknown; rows?: unknown };
  if (assessment.kind !== "sor" && assessment.kind !== "soch") return false;
  if (!Array.isArray(assessment.rows) || assessment.rows.length > 60) return false;
  return assessment.rows.every((row) => {
    if (!row || typeof row !== "object") return false;
    const item = row as { task?: unknown; criterion?: unknown; descriptor?: unknown; points?: unknown };
    return Number.isInteger(item.task) && (item.task as number) >= 1 && (item.task as number) <= 50 &&
      typeof item.criterion === "string" && item.criterion.length <= 500 &&
      typeof item.descriptor === "string" && item.descriptor.length <= 500 &&
      Number.isInteger(item.points) && (item.points as number) >= 0 && (item.points as number) <= 10;
  });
}
