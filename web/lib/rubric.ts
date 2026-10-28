import type { TestVariant } from "./types";

/** True when the table no longer has exactly one row per task of the variant. */
export function rubricIsStale(variant: TestVariant) {
  const rows = variant.assessment?.rows || [];
  const tasks = new Set(rows.map(row => row.task));
  return rows.some(row => row.task > variant.questions.length) || variant.questions.some((_, i) => !tasks.has(i + 1));
}

/**
 * Points each question is worth in the variant's СОР/СОЧ table, keyed by
 * question id, or null when the variant has no usable table (then every
 * question counts the same). A stale table never decides a score.
 */
export function questionPoints(variant: TestVariant): Map<string, number> | null {
  const rows = variant.assessment?.rows;
  if (!rows?.length || rubricIsStale(variant)) return null;
  const points = new Map(variant.questions.map((question, index) => [
    question.id, rows.filter(row => row.task === index + 1).reduce((sum, row) => sum + row.points, 0),
  ]));
  let total = 0;
  for (const value of points.values()) total += value;
  return total > 0 ? points : null;
}
