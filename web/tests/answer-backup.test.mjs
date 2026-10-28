import test from "node:test";
import assert from "node:assert/strict";
import { restoreAnswers } from "../lib/answer-backup.ts";

const server = { q1: "server", q2: "kept" };

test("an unconfirmed copy always wins, question by question", () => {
  assert.deepEqual(restoreAnswers(server, { answers: { q1: "offline" }, at: 1 }), { q1: "offline", q2: "kept" });
  assert.deepEqual(restoreAnswers(server, null), server);
});

test("a late save of an older answer cannot hide a newer unsent one", () => {
  // 10:00:01 save of "old" starts; 10:00:02 the student types "new" (kept on
  // the device); 10:00:03 the old save lands on the server; then a reload.
  const serverAfterLateSave = { q1: "old" };
  const copy = { answers: { q1: "new" }, at: Date.parse("2026-10-27T10:00:02Z") };
  assert.deepEqual(restoreAnswers(serverAfterLateSave, copy), { q1: "new" });
});

test("other students' and day-old copies are removed from the device", async () => {
  const store = new Map();
  globalThis.window = { localStorage: {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  } };
  const { pruneBackups } = await import("../lib/answer-backup.ts");
  const now = Date.parse("2026-10-27T12:00:00Z");
  store.set("mugalim_answers:t1:me", JSON.stringify({ answers: {}, at: now - 1000 }));
  store.set("mugalim_answers:t2:me", JSON.stringify({ answers: {}, at: now - 13 * 3600_000 }));
  store.set("mugalim_answers:t1:someone-else", JSON.stringify({ answers: { q1: "secret" }, at: now - 1000 }));
  store.set("mugalim_lang", "kk");
  pruneBackups("me", now);
  assert.deepEqual([...store.keys()].sort(), ["mugalim_answers:t1:me", "mugalim_lang"]);
  delete globalThis.window;
});
