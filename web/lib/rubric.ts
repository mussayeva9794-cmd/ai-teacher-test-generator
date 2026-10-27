import type { TestVariant } from "./types";

/** True when the table no longer has exactly one row per task of the variant. */
export function rubricIsStale(variant: TestVariant) {
  const rows = variant.assessment?.rows || [];
  const tasks = new Set(rows.map(row => row.task));
  return rows.some(row => row.task > variant.questions.length) || variant.questions.some((_, i) => !tasks.has(i + 1));
}
