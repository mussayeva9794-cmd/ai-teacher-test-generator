import type { Question } from "./types";
import { shownScore } from "./scoring";

// Class analytics computed in the browser from the attempts the teacher can
// already see: a student × question heat map and per-question statistics.

export type AnalyticsAttempt = {
  id: string;
  student_name: string;
  variant_name: string;
  answers: Record<string, unknown>;
  result?: { per_question?: { id: string; score: number | null; requires_manual_review?: boolean }[] } | null;
};

export type QuestionStats = {
  id: string;
  number: number;
  text: string;
  type: Question["type"] | null;
  // Average score over graded answers, 0–1; null when nothing is graded yet.
  average: number | null;
  graded: number;
  unanswered: number;
  // The most frequent wrong answers, for questions with fixed options.
  wrongAnswers: { answer: string; count: number }[];
  level: "easy" | "ok" | "hard" | null;
};

export type HeatRow = { attemptId: string; student: string; total: number | null; cells: (number | null)[] };

export type VariantAnalytics = { variant: string; attempts: number; questions: QuestionStats[]; rows: HeatRow[] };

const EASY = 0.9;
const HARD = 0.4;

function isEmpty(value: unknown) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && !Array.isArray(value) && Object.values(value as object).every((item) => !item));
}

function key(value: unknown) {
  return Array.isArray(value) ? value.map(String).join("; ") : String(value ?? "").trim();
}

export function analyzeVariant(variant: string, attempts: AnalyticsAttempt[], questions: Question[]): VariantAnalytics {
  const mine = attempts.filter((attempt) => attempt.variant_name === variant);
  // Question order and ids come from the graded attempts (the link's snapshot);
  // the current test only supplies wording, which may have been edited since.
  const ids: string[] = [];
  for (const attempt of mine) for (const row of attempt.result?.per_question || []) if (!ids.includes(row.id)) ids.push(row.id);
  if (!ids.length) for (const question of questions) ids.push(question.id);
  const byId = new Map(questions.map((question) => [question.id, question]));

  const rows: HeatRow[] = mine.map((attempt) => {
    const stored = new Map((attempt.result?.per_question || []).map((row) => [row.id, row]));
    // shownScore also rescores answers whose per-question scores a teacher's
    // manual review cleared.
    const cells = ids.map((id) => {
      const row = stored.get(id);
      // A question this attempt was not graded on (another snapshot) has no score.
      if (!row) return null;
      const question = byId.get(id);
      if (question) return shownScore(question, attempt.answers?.[id], row);
      return row && !row.requires_manual_review && typeof row.score === "number" ? row.score : null;
    });
    const graded = cells.filter((cell): cell is number => cell !== null);
    return {
      attemptId: attempt.id, student: attempt.student_name, cells,
      total: graded.length === cells.length && cells.length ? graded.reduce((sum, cell) => sum + cell, 0) / cells.length : null,
    };
  });

  const stats = ids.map((id, index): QuestionStats => {
    const question = byId.get(id);
    const scores = rows.map((row) => row.cells[index]).filter((cell): cell is number => cell !== null);
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
    const wrong = new Map<string, number>();
    let unanswered = 0;
    mine.forEach((attempt, row) => {
      const answer = attempt.answers?.[id];
      if (isEmpty(answer)) { unanswered += 1; return; }
      const cell = rows[row].cells[index];
      if (question?.options && cell !== null && cell < 1) wrong.set(key(answer), (wrong.get(key(answer)) || 0) + 1);
    });
    return {
      id, number: index + 1, text: question?.question || "", type: question?.type || null,
      average, graded: scores.length, unanswered,
      wrongAnswers: [...wrong].map(([answer, count]) => ({ answer, count })).sort((a, b) => b.count - a.count).slice(0, 3),
      level: average === null || scores.length < 3 ? null : average >= EASY ? "easy" : average < HARD ? "hard" : "ok",
    };
  });
  return { variant, attempts: mine.length, questions: stats, rows };
}
