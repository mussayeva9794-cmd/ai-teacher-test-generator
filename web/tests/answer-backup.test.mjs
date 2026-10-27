import test from "node:test";
import assert from "node:assert/strict";
import { restoreAnswers } from "../lib/answer-backup.ts";

const server = { q1: "server", q2: "kept" };

test("a backup newer than the server's last save wins, question by question", () => {
  const savedAt = "2026-10-27T08:00:00Z";
  const newer = { answers: { q1: "offline" }, at: Date.parse(savedAt) + 5000 };
  assert.deepEqual(restoreAnswers(server, savedAt, newer, 0), { q1: "offline", q2: "kept" });
});

test("an older backup never overwrites what the server has", () => {
  const savedAt = "2026-10-27T08:00:00Z";
  assert.deepEqual(restoreAnswers(server, savedAt, { answers: { q1: "old" }, at: Date.parse(savedAt) - 1 }, 0), server);
  assert.deepEqual(restoreAnswers(server, savedAt, null, 0), server);
});

test("the device clock is corrected by the server offset before comparing", () => {
  const savedAt = "2026-10-27T08:00:00Z";
  // The device clock runs 10 minutes fast: its "later" backup is really older.
  const fastDevice = { answers: { q1: "stale" }, at: Date.parse(savedAt) + 5 * 60_000 };
  assert.deepEqual(restoreAnswers(server, savedAt, fastDevice, -10 * 60_000), server);
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
