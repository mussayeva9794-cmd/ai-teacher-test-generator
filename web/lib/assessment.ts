import { createHash } from "node:crypto";
import type { Question, ShareSettings, TestVariant } from "./types";
import { isValidVariant } from "./question-validation";
import { answerText, correctText } from "./answer-format";
import { needsTeacher, questionScore, shownScore } from "./scoring";
import { scrambledOrder } from "./scramble";

export { isValidVariant };

function shuffle<T>(items: T[], seed: string): T[] {
  const result = [...items];
  let counter = 0;
  for (let i = result.length - 1; i > 0; i--) {
    const hash = createHash("sha256").update(`${seed}:${counter++}`).digest();
    const j = hash.readUInt32BE(0) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function personalizedVariant(variant: TestVariant, token: string, studentId: string, randomize: boolean): TestVariant {
  if (!randomize) return variant;
  const seed = `${token}:${studentId}`;
  const questions = shuffle(variant.questions, seed).map((question) => ({
    ...question,
    options: question.options ? shuffle(question.options, `${seed}:${question.id}:options`) : undefined,
    pairs: question.pairs ? shuffle(question.pairs, `${seed}:${question.id}:pairs`) : undefined,
  }));
  return { ...variant, questions };
}

export function studentVariant(variant: TestVariant) {
  return {
    title: variant.title,
    instructions: variant.instructions,
    questions: variant.questions.map(({ correct_answer: _answer, correct_answers: _answers, explanation: _explanation, source_reference: _sourceReference, ...question }) => ({
      ...question,
      // Ordering items go out shuffled; their stored order is the answer.
      items: question.items ? scrambled(question.items, question.id) : undefined,
      // Matching rows are rendered from the left side only; never send the answer mapping to students.
      pairs: question.pairs?.map(({ left }) => ({ left, right: "" })),
      // The right-hand choices go out sorted on their own, so their order says
      // nothing about which left item each one belongs to.
      match_options: question.pairs ? question.pairs.map(({ right }) => right).sort((a, b) => a.localeCompare(b)) : undefined,
    })),
  };
}

/** A fixed shuffle per question that never equals the correct order. */
export function scrambled(items: string[], seed: string): string[] {
  return scrambledOrder(items, seed);
}

/**
 * An ordering question the student never moved still has an order on screen:
 * the starting order every student is shown. Grade and review that order.
 */
function effectiveAnswer(question: Question, answer: unknown): unknown {
  return question.type === "ordering" && !Array.isArray(answer) && question.items?.length
    ? scrambled(question.items, question.id) : answer;
}

export function grade(variant: TestVariant, answers: Record<string, unknown>) {
  const needsReview = (question: Question) => needsTeacher(question, answers[question.id]);
  const requiresManualReview = variant.questions.some(needsReview);
  const perQuestion = variant.questions.map((question) => ({
    id: question.id,
    skill_tag: question.skill_tag,
    score: questionScore(question, effectiveAnswer(question, answers[question.id])),
    requires_manual_review: needsReview(question),
  }));
  const total = perQuestion.reduce((sum, result) => sum + result.score, 0);
  return {
    percentage: requiresManualReview ? null : Math.round((total / variant.questions.length) * 10000) / 100,
    requires_manual_review: requiresManualReview,
    total_score: Math.round(total * 100) / 100,
    total_questions: variant.questions.length,
    per_question: perQuestion,
  };
}

export function parseSettings(value: unknown): ShareSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const timer = Number(source.timer_minutes || 0);
  const strict = source.strict_mode === true;
  const leaveLimit = Math.floor(Number(source.leave_limit ?? 2));
  const questionSeconds = Math.floor(Number(source.question_seconds || 0));
  return {
    allowed_students: Array.isArray(source.allowed_students)
      ? source.allowed_students.map((email) => String(email).trim().toLowerCase()).filter(Boolean) : [],
    deadline_at: typeof source.deadline_at === "string" && source.deadline_at ? source.deadline_at : null,
    timer_minutes: Number.isFinite(timer) ? Math.max(0, Math.min(240, Math.floor(timer))) : 0,
    // Strict mode always shows one question at a time.
    one_question_at_a_time: Boolean(source.one_question_at_a_time) || strict,
    randomize: source.randomize !== false,
    reveal_score: source.reveal_score === true,
    reveal_answers: source.reveal_answers === true,
    strict_mode: strict,
    leave_limit: source.leave_limit === null ? null : Number.isFinite(leaveLimit) ? Math.max(0, Math.min(5, leaveLimit)) : 2,
    // Links created before this setting existed keep their original behaviour.
    require_fullscreen: strict && source.require_fullscreen === true,
    question_seconds: Number.isFinite(questionSeconds) && questionSeconds > 0 ? Math.max(15, Math.min(600, questionSeconds)) : 0,
  };
}

export type ReviewItem = {
  id: string;
  question: string;
  given: string;
  correct: string;
  explanation: string;
  // null when only the teacher can judge the answer.
  score: number | null;
  checked: boolean;
};

/** The after-submission review a teacher can allow; only built for submitted attempts. */
export function answerReview(variant: TestVariant, answers: Record<string, unknown>, result: unknown): ReviewItem[] {
  const perQuestion = new Map<string, { score?: number | null; requires_manual_review?: boolean }>();
  const rows = result && typeof result === "object" ? (result as { per_question?: unknown }).per_question : null;
  if (Array.isArray(rows)) for (const row of rows) if (row && typeof row.id === "string") perQuestion.set(row.id, row);
  const reviewed = Boolean(result && typeof result === "object" && (result as { manually_reviewed_by?: unknown }).manually_reviewed_by);
  return variant.questions.map((question) => {
    const answer = effectiveAnswer(question, answers?.[question.id]);
    const score = shownScore(question, answer, perQuestion.get(question.id));
    return {
      id: question.id,
      question: question.question,
      given: answerText(question, answer),
      correct: correctText(question),
      explanation: question.explanation || "",
      score,
      // The teacher already set the total by hand; this answer was part of it.
      checked: score === null && reviewed,
    };
  });
}
