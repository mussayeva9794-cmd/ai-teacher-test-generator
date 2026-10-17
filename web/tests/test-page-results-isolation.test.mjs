import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/tests/[id]/page.tsx", import.meta.url), "utf8");

test("results API failure does not block loading the teacher test and share links", () => {
  const refreshMatch = page.match(/async function refresh\(\) \{([\s\S]*?)\n  \}\n  useEffect/);
  assert.ok(refreshMatch, "refresh function should be present");
  const refresh = refreshMatch[1];
  const primaryRequests = refresh.match(/Promise\.all\(\[([\s\S]*?)\]\)/);
  assert.ok(primaryRequests, "test and share requests should load together");
  assert.match(primaryRequests[1], /\/api\/tests\/\$\{id\}/);
  assert.match(primaryRequests[1], /\/api\/tests\/\$\{id\}\/share/);
  assert.doesNotMatch(primaryRequests[1], /\/attempts\?/);
  assert.ok(refresh.indexOf("setTest(testResult.test)") < refresh.indexOf("const attemptResult = await api"));
  assert.match(refresh, /catch \(cause\) \{\s*setResultsError\(/);
});

test("results refresh, polling, and export failures are displayed in the results tab", () => {
  assert.match(page, /\.catch\(cause => setResultsError\(/);
  assert.match(page, /catch \(cause\) \{ setResultsError\(/);
  assert.match(page, /\{tab === "results" && <div className="stack">\{resultsError && <div className="error" role="alert">/);
  assert.match(page, /Показанные ниже данные могут быть устаревшими/);
  assert.match(page, /disabled=\{!attempts\.length \|\| exporting \|\| Boolean\(resultsError\)\}/);
  assert.match(page, /resultsError \? "Нет актуальных данных, так как обновление завершилось ошибкой\."/);
});
