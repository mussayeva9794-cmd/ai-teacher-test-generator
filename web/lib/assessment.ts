import { createHash } from "node:crypto";
import type { Question, ShareSettings, TestVariant } from "./types";
import { isValidVariant } from "./question-validation";
import { answerText, correctText } from "./answer-format";
import { dictationNorms, needsTeacher, questionScore, shownScore } from "./scoring";
import { dictationRecord, readDictationRecord, type DictationRecord } from "./dictation";
import { scrambledOrder } from "./scramble";
import { questionPoints, rubricIsStale } from "./rubric";

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
  // Table rows name tasks by position, so they follow the questions to their new places.
  const assessment = variant.assessment && !rubricIsStale(variant) ? {
    ...variant.assessment,
    rows: variant.assessment.rows.map((row) => ({
      ...row, task: questions.findIndex((question) => question.id === variant.questions[row.task - 1].id) + 1,
    })),
  } : variant.assessment;
  return { ...variant, questions, ...(assessment ? { assessment } : {}) };
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
      // Copying is the only work where the student sees the teacher's text.
      copy_text: question.type === "dictation" && question.dictation_mode === "copy" ? _answer : undefined,
    })),
  };
}

/**
 * The starting order students get for an ordering question: fixed per
 * question and never the answer. The seed mixes in a server-only secret,
 * because the question id is sent to the browser and an id-only seed would
 * let a student undo the shuffle and read off the correct order.
 */
export function scrambled(items: string[], questionId: string): string[] {
  const secret = process.env.ORDERING_SEED_SECRET || process.env.SUPABASE_SECRET_KEY || "";
  // The items themselves (sorted, so not their answer order) are part of the
  // seed: ids like "easy-1" repeat across tests, and one solved question must
  // not reveal the permutation of another.
  const content = JSON.stringify([...items].sort());
  const seed = createHash("sha256").update(`mugalim-order:${secret}:${questionId}:${content}`).digest("hex");
  return scrambledOrder(items, seed);
}

/** The overall percentage of graded rows; with a СОР/СОЧ table it follows the table's points, as on paper. */
export function percentageOf(rows: { score: number; points?: number }[]): number {
  const earned = rows.reduce((sum, result) => sum + result.score * (result.points ?? 1), 0);
  const possible = rows.reduce((sum, result) => sum + (result.points ?? 1), 0);
  return possible > 0 ? Math.round((earned / possible) * 10000) / 100 : 0;
}

export function grade(variant: TestVariant, answers: Record<string, unknown>) {
  const needsReview = (question: Question) => needsTeacher(question, answers[question.id]);
  const requiresManualReview = variant.questions.some(needsReview);
  const points = questionPoints(variant);
  const perQuestion = variant.questions.map((question) => {
    const dictation = question.type === "dictation"
      ? dictationRecord(question.correct_answer, answers[question.id], question.dictation_mode ?? "dictation", dictationNorms(question)) : null;
    return {
      id: question.id,
      skill_tag: question.skill_tag,
      score: dictation ? dictation.score : questionScore(question, answers[question.id]),
      requires_manual_review: needsReview(question),
      ...(points ? { points: points.get(question.id) ?? 0 } : {}),
      ...(dictation ? { dictation: dictation.record } : {}),
    };
  });
  const total = perQuestion.reduce((sum, result) => sum + result.score, 0);
  return {
    percentage: requiresManualReview ? null : percentageOf(perQuestion),
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
  // A dictation shows the student's text with the mistakes the teacher kept.
  dictation?: DictationRecord;
};

/** The after-submission review a teacher can allow; only built for submitted attempts. */
export function answerReview(variant: TestVariant, answers: Record<string, unknown>, result: unknown): ReviewItem[] {
  const perQuestion = new Map<string, { score?: number | null; requires_manual_review?: boolean; dictation?: unknown }>();
  const rows = result && typeof result === "object" ? (result as { per_question?: unknown }).per_question : null;
  if (Array.isArray(rows)) for (const row of rows) if (row && typeof row.id === "string") perQuestion.set(row.id, row);
  const reviewed = Boolean(result && typeof result === "object" && (result as { manually_reviewed_by?: unknown }).manually_reviewed_by);
  return variant.questions.map((question) => {
    const answer = answers?.[question.id];
    const stored = perQuestion.get(question.id);
    const score = shownScore(question, answer, stored);
    const dictation = question.type === "dictation" ? readDictationRecord(stored?.dictation) : null;
    return {
      id: question.id,
      question: question.question,
      given: answerText(question, answer),
      correct: correctText(question),
      explanation: question.explanation || "",
      score,
      // The teacher already set the total by hand; this answer was part of it.
      checked: score === null && reviewed,
      ...(dictation ? { dictation } : {}),
    };
  });
}
