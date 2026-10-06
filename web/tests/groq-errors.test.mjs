import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyGroqStatus, publicGenerationError } from "../lib/groq-error.ts";

test("Groq HTTP failures preserve useful categories without exposing provider details", () => {
  assert.equal(classifyGroqStatus(401), "authentication");
  assert.equal(classifyGroqStatus(429), "rate_limit");
  assert.equal(classifyGroqStatus(400), "request_rejected");
  assert.equal(classifyGroqStatus(404), "request_rejected");
  assert.equal(classifyGroqStatus(503), "upstream");
});

test("public generation errors are actionable and never reveal configuration names", () => {
  const rejected = publicGenerationError("request_rejected");
  assert.equal(rejected.status, 503);
  assert.match(rejected.message, /администратор/i);
  assert.doesNotMatch(rejected.message, /GROQ_API_KEY|Bearer|api\.groq/i);
  assert.equal(publicGenerationError("rate_limit").status, 429);
  assert.match(publicGenerationError("upstream").message, /попробуйте позже/i);
});

test("create page explains review and draft behavior without technical key names", () => {
  const page = readFileSync(fileURLToPath(new URL("../app/create/page.tsx", import.meta.url)), "utf8");
  assert.doesNotMatch(page, /GROQ_API_KEY/);
  assert.match(page, /неполный тест не сохранится/i);
});
