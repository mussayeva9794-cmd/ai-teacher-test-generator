import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { csvCell, spreadsheetSafeText } from "../lib/csv-export.ts";

test("formula-leading student text is prefixed for spreadsheet import", () => {
  for (const value of ["=1+1", "+SUM(A1:A2)", "-1+2", "@SUM(A1)", "\t=cmd", "\r\n=1+1", "\uFEFF=1+1"]) {
    assert.equal(spreadsheetSafeText(value), `'${value}`);
  }
});

test("ordinary values, Unicode, CSV punctuation, and line breaks are retained", () => {
  assert.equal(spreadsheetSafeText("Айжан, \"А\""), "Айжан, \"А\"");
  assert.equal(csvCell("Айжан, \"А\""), '"Айжан, ""А"""');
  assert.equal(csvCell("line 1\nline 2"), '"line 1\nline 2"');
  assert.equal(csvCell(85), '"85"');
});

test("CSV builder serializes formula-like text as quoted text and keeps the report columns", () => {
  const row = ["=HYPERLINK(\"https://example.test\")", "Variant A", 90, "2026-10-07T10:00:00Z"];
  const csv = [
    ["Ученик", "Вариант", "Оценка (%)", "Сдано"],
    row,
  ].map((cells) => cells.map(csvCell).join(",")).join("\n");

  assert.equal(csv, '"Ученик","Вариант","Оценка (%)","Сдано"\n"\'=HYPERLINK(""https://example.test"")","Variant A","90","2026-10-07T10:00:00Z"');
});

test("attempts API and UI export builder use the safe student name and CSV serializer", async () => {
  const route = await readFile(new URL("../app/api/tests/[id]/attempts/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/tests/[id]/page.tsx", import.meta.url), "utf8");

  assert.match(route, /csv_student_name:\s*spreadsheetSafeText\(studentName\)/);
  assert.match(page, /a\.csv_student_name\s*\?\?\s*a\.student_name/);
  assert.match(page, /row\.map\(csvCell\)/);
});
