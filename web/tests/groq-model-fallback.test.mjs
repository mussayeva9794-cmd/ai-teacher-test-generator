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
