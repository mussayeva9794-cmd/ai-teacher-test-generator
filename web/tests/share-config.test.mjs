import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("student share endpoints fail closed when the server Supabase key is missing", () => {
  const source = readFileSync(new URL("../lib/share.ts", import.meta.url), "utf8");

  assert.match(source, /if \(actor\.role !== "student"\) return/);
  assert.match(source, /try \{\s*admin = adminClient\(\);\s*\} catch \{/);
  assert.match(source, /status: 503/);
  assert.doesNotMatch(source, /return \{ error: error\.message/);
});
