import { createHash } from "node:crypto";
import type { Question, ShareSettings, TestVariant } from "./types";

export function isValidVariant(value: unknown): value is TestVariant {
  if (!value || typeof value !== "object") return false;
  const variant = value as TestVariant;
  return typeof variant.title === "string" && Array.isArray(variant.questions) &&
    variant.questions.length > 0 && variant.questions.length <= 50 &&
    variant.questions.every((q) =>
      typeof q.id === "string" && typeof q.question === "string" &&
      typeof q.correct_answer === "string" &&
      ["multiple_choice", "true_false", "short_answer", "matching"].includes(q.type) &&
      (q.type !== "multiple_choice" && q.type !== "true_false" ||
        (Array.isArray(q.options) && q.options.includes(q.correct_answer))) &&
      (q.type !== "matching" || Array.isArray(q.pairs))
    );
}

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
    questions: variant.questions.map(({ correct_answer: _answer, explanation: _explanation, ...question }) => question),
  };
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function questionScore(question: Question, answer: unknown): number {
  if (question.type === "matching") {
    if (!answer || typeof answer !== "object" || !question.pairs?.length) return 0;
    const given = answer as Record<string, string>;
    return question.pairs.filter((pair) => normalized(given[pair.left]) === normalized(pair.right)).length / question.pairs.length;
  }
  if (question.type === "short_answer") {
    const expected = normalized(question.correct_answer);
    const student = normalized(answer);
    if (!student || !expected) return 0;
    if (student === expected) return 1;
    const expectedWords = new Set(expected.split(" "));
    if (expectedWords.size < 3) return 0;
    const matchingWords = [...new Set(student.split(" "))].filter((word) => expectedWords.has(word) && word.length > 2).length;
    return matchingWords / expectedWords.size >= 0.7 ? 0.8 : 0;
  }
  return normalized(answer) === normalized(question.correct_answer) ? 1 : 0;
}

export function grade(variant: TestVariant, answers: Record<string, unknown>) {
  const perQuestion = variant.questions.map((question) => ({
    id: question.id,
    skill_tag: question.skill_tag,
    score: questionScore(question, answers[question.id]),
  }));
  const total = perQuestion.reduce((sum, result) => sum + result.score, 0);
  return {
    percentage: Math.round((total / variant.questions.length) * 10000) / 100,
    total_score: Math.round(total * 100) / 100,
    total_questions: variant.questions.length,
    per_question: perQuestion,
  };
}

export function parseSettings(value: unknown): ShareSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const timer = Number(source.timer_minutes || 0);
  return {
    allowed_students: Array.isArray(source.allowed_students)
      ? source.allowed_students.map((email) => String(email).trim().toLowerCase()).filter(Boolean) : [],
    deadline_at: typeof source.deadline_at === "string" && source.deadline_at ? source.deadline_at : null,
    timer_minutes: Number.isFinite(timer) ? Math.max(0, Math.min(240, Math.floor(timer))) : 0,
    one_question_at_a_time: Boolean(source.one_question_at_a_time),
    randomize: source.randomize !== false,
    reveal_score: source.reveal_score === true,
  };
}
