import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// lib/ uses extensionless relative imports (resolved by Next); add ".ts" here.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("./") && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.includes("/lib/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const input = { topic: "Фотосинтез", count: 2, type: "multiple_choice", language: "russian", gradeLevel: "7", objective: "" };

function variantPayload() {
  const questions = [1, 2].map((n) => ({
    id: `q${n}`, type: "multiple_choice", question: `Вопрос ${n}?`, options: ["А", "Б", "В", "Г"],
    correct_answer: "А", explanation: "Потому что А.", skill_tag: "фотосинтез", source_reference: "",
  }));
  return { choices: [{ message: { content: JSON.stringify({ title: "Тест", instructions: "Ответьте.", questions }) } }] };
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const models = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    models.push(body.model);
    return handler(body);
  };
  process.env.GROQ_API_KEY = "gsk_test";
  delete process.env.GROQ_MODEL;
  try { await run(models); } finally { globalThis.fetch = original; }
}

test("generation uses the 120b model with medium reasoning by default", async () => {
  const { generateVariants } = await import("../lib/groq.ts");
  await withFetch(() => Response.json(variantPayload()), async (models) => {
    const variants = await generateVariants(input);
    assert.deepEqual(Object.keys(variants), ["Variant A", "Variant B", "Variant C", "Variant D"]);
    assert.ok(models.every((model) => model === "openai/gpt-oss-120b"));
  });
});

test("a rate-limited or missing primary model falls back to 20b", async () => {
  const { generateVariants } = await import("../lib/groq.ts");
  for (const status of [429, 404]) {
    await withFetch((body) => body.model === "openai/gpt-oss-120b"
      ? new Response("{}", { status })
      : Response.json(variantPayload()), async (models) => {
      const variants = await generateVariants(input);
      assert.equal(variants["Variant A"].questions.length, 2);
      assert.ok(models.includes("openai/gpt-oss-20b"), `fallback on ${status}`);
    });
  }
});

test("a rejected API key does not silently switch models", async () => {
  const { generateVariants, GroqGenerationError } = await import("../lib/groq.ts");
  await withFetch(() => new Response("{}", { status: 401 }), async (models) => {
    await assert.rejects(generateVariants(input), (error) => error instanceof GroqGenerationError && error.reason === "authentication");
    assert.deepEqual(models, ["openai/gpt-oss-120b"]);
  });
});

test("an AI grading reply that skips answers is a failed call, so quota is refunded", async () => {
  const { suggestGrades } = await import("../lib/groq.ts");
  const items = [{ key: "a:q1", question: "Q?", modelAnswer: "A", studentAnswer: "A" }];
  await withFetch(() => Response.json({ choices: [{ message: { content: JSON.stringify({ grades: [] }) } }] }), async () => {
    await assert.rejects(() => suggestGrades(items, "russian"), (error) => error.reason === "invalid_response");
  });
});

test("a mixed test keeps each question's own type and asks for all of them", async () => {
  const { generateVariants } = await import("../lib/groq.ts");
  const questions = [
    { id: "q1", type: "multiple_choice", question: "Что нужно растению?", options: ["Свет", "Шум", "Песок", "Лёд"], correct_answers: [], items: [], pairs: [],
      correct_answer: "Свет", explanation: "Свет.", skill_tag: "фотосинтез", source_reference: "", bloom_level: "knowledge" },
    { id: "q2", type: "true_false", question: "Листья выделяют кислород.", options: [], correct_answers: [], items: [], pairs: [],
      correct_answer: "true", explanation: "Да.", skill_tag: "фотосинтез", source_reference: "", bloom_level: "knowledge" },
    { id: "q3", type: "matching", question: "Сопоставьте.", options: [], correct_answers: [], items: [], pairs: [{ left: "Хлорофилл", right: "Пигмент" }, { left: "Устьица", right: "Газообмен" }],
      correct_answer: "", explanation: "Так.", skill_tag: "фотосинтез", source_reference: "", bloom_level: "understanding" },
  ];
  await withFetch((body) => {
    const schema = body.response_format.json_schema.schema.properties.questions.items;
    assert.ok(schema.properties.type.enum.length >= 6 && schema.properties.pairs && schema.properties.items);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ title: "Тест", instructions: "Ответьте.", questions }) } }] });
  }, async () => {
    const variants = await generateVariants({ ...input, count: 3, type: "mixed" });
    const got = variants["Variant A"].questions;
    assert.deepEqual(got.map((q) => q.type), ["multiple_choice", "true_false", "matching"]);
    assert.equal(got[1].correct_answer, "Верно");
    assert.equal(got[0].pairs, undefined);
    assert.equal(got[2].pairs.length, 2);
  });
});

test("a mixed test of one question type is sent back to the AI", async () => {
  const { generateVariants, GroqGenerationError } = await import("../lib/groq.ts");
  let calls = 0;
  await withFetch(() => { calls += 1; return Response.json(variantPayload()); }, async () => {
    await assert.rejects(generateVariants({ ...input, type: "mixed" }), (error) => error instanceof GroqGenerationError && error.reason === "invalid_response");
    assert.ok(calls > 1, "retried before giving up");
  });
});
