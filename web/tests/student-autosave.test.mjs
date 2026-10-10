import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/s/[token]/page.tsx", import.meta.url), "utf8");

test("queued autosaves take the latest answer snapshot and skip duplicate writes", () => {
  assert.match(page, /const pendingAnswers = latestAnswers\.current;\s*const pendingSerialized = JSON\.stringify\(pendingAnswers\);/);
  assert.match(page, /if \(pendingSerialized === lastSaved\.current\) return;/);
  assert.match(page, /JSON\.stringify\(latestAnswers\.current\) === pendingSerialized/);
});

test("timer submission cancels and flushes a pending debounce before using the saved draft", () => {
  assert.match(page, /const saveTimer = useRef<ReturnType<typeof setTimeout> \| null>\(null\);/);
  assert.match(page, /async function flushPendingDraft\(\)[\s\S]*?clearTimeout\(saveTimer\.current\)[\s\S]*?await saveLatestDraft\(\)/);
  assert.match(page, /const draftSaved = await flushPendingDraft\(\);[\s\S]*?method: "POST"/);
  assert.match(page, /wasExpired && !draftSaved/);
});

test("student autosave speeds up near expiry and warns that the last seconds depend on connectivity", () => {
  assert.match(page, /remaining !== null && remaining <= 15 \? 100 : 650/);
  assert.match(page, /remaining > 0 && remaining <= 15/);
  assert.match(page, /при медленной сети, может не успеть сохраниться/);
  assert.match(page, /Учителю отправлен последний черновик, который успел сохраниться/);
});
