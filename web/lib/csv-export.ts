const FORMULA_PREFIX = /^[\u0000-\u0020\u007f-\u009f\uFEFF]*[=+@-]/u;

/** Prefix formula-like text so spreadsheet apps import it as text. */
export function spreadsheetSafeText(value: unknown): string {
  const text = String(value ?? "");
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

/** Quote a CSV field and escape quotes without allowing formula execution. */
export function csvCell(value: unknown): string {
  const text = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : spreadsheetSafeText(value);
  return `"${text.replaceAll('"', '""')}"`;
}
