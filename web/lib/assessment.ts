import { createHash } from "node:crypto";
import type { Question, ShareSettings, TestVariant } from "./types";

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

  return variant.questions.every((value) => {
    if (!value || typeof value !== "object") return false;
    const question = value as Partial<Question>;
    if (typeof question.id !== "string" || !question.id.trim() || typeof question.question !== "string" ||
      !question.question.trim() || typeof question.correct_answer !== "string" ||
      !["multiple_choice", "true_false", "short_answer", "matching"].includes(question.type || "") ||
      (question.source_reference !== undefined && (typeof question.source_reference !== "string" || question.source_reference.length > 320))) return false;

    if (question.type === "multiple_choice" || question.type === "true_false") {
      if (!Array.isArray(question.options)) return false;
      // Legacy teacher-authored tests may have two or three choices. Reject a
      // one-choice question, but do not invalidate an already published test.
      const requiredCount = 2;
      const options = question.options;
      if (options.length < requiredCount || !options.every((option) => typeof option === "string" && Boolean(option.trim()))) return false;
      const normalizedOptions = options.map((option) => option.trim().toLocaleLowerCase());
      return new Set(normalizedOptions).size === options.length && normalizedOptions.includes(question.correct_answer.trim().toLocaleLowerCase());
    }

    if (question.type === "matching") {
      if (!Array.isArray(question.pairs) || question.pairs.length < 2) return false;
      const left = new Set<string>();
      const right = new Set<string>();
      return question.pairs.every((pair) => {
        if (!pair || typeof pair.left !== "string" || typeof pair.right !== "string" || !pair.left.trim() || !pair.right.trim()) return false;
        const normalizedLeft = pair.left.trim().toLocaleLowerCase();
        const normalizedRight = pair.right.trim().toLocaleLowerCase();
        if (left.has(normalizedLeft) || right.has(normalizedRight)) return false;
        left.add(normalizedLeft); right.add(normalizedRight);
        return true;
      });
    }

    return Boolean(question.correct_answer.trim());
  });
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
    questions: variant.questions.map(({ correct_answer: _answer, explanation: _explanation, source_reference: _sourceReference, ...question }) => ({
      ...question,
      // Matching rows are rendered from the left side only; never send the answer mapping to students.
      pairs: question.pairs?.map(({ left }) => ({ left, right: "" })),
    })),
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
    return student && expected && student === expected ? 1 : 0;
  }
  return normalized(answer) === normalized(question.correct_answer) ? 1 : 0;
}

export function grade(variant: TestVariant, answers: Record<string, unknown>) {
  const needsReview = (question: Question) => question.type === "short_answer" &&
    typeof answers[question.id] === "string" && Boolean((answers[question.id] as string).trim()) &&
    normalized(answers[question.id]) !== normalized(question.correct_answer);
  const requiresManualReview = variant.questions.some(needsReview);
  const perQuestion = variant.questions.map((question) => ({
    id: question.id,
    skill_tag: question.skill_tag,
    score: questionScore(question, answers[question.id]),
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
