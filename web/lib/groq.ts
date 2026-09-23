import type { Question, QuestionType, TestVariant } from "./types";
import { isValidVariant } from "./assessment";
import { networkErrorCode } from "./network-error";

export type GenerateInput = {
  topic: string;
  count: number;
  type: QuestionType;
  language: "russian" | "kazakh" | "english";
  gradeLevel: string;
  objective: string;
  sourceText?: string;
};

export class GroqGenerationError extends Error {
  constructor(
    public readonly reason: "configuration" | "authentication" | "rate_limit" | "timeout" | "upstream" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "GroqGenerationError";
  }
}

const TRUE_FALSE_OPTIONS = {
  russian: ["Верно", "Неверно"],
  kazakh: ["Дұрыс", "Бұрыс"],
  english: ["True", "False"],
} as const;

function generationAttempts(): number {
  const configured = Number(process.env.MAX_GENERATION_ATTEMPTS || 2);
  return Number.isInteger(configured) ? Math.max(1, Math.min(4, configured)) : 2;
}

function responseSchema(input: GenerateInput) {
  const questionProperties: Record<string, unknown> = {
    id: { type: "string" },
    type: { type: "string", enum: [input.type] },
    question: { type: "string" },
    correct_answer: { type: "string" },
    explanation: { type: "string" },
    skill_tag: { type: "string" },
  };
  if (input.type === "multiple_choice" || input.type === "true_false") {
    questionProperties.options = {
      type: "array",
      items: { type: "string" },
    };
  }
  if (input.type === "matching") {
    questionProperties.pairs = {
      type: "array",
      items: {
        type: "object",
        properties: {
          left: { type: "string" },
          right: { type: "string" },
        },
        required: ["left", "right"],
        additionalProperties: false,
      },
    };
  }

  return {
    type: "object",
    properties: {
      title: { type: "string" },
      instructions: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: questionProperties,
          required: Object.keys(questionProperties),
          additionalProperties: false,
        },
      },
    },
    required: ["title", "instructions", "questions"],
    additionalProperties: false,
  };
}

function canonicalTrueFalse(value: unknown, language: GenerateInput["language"]): string {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  const truthy = new Set(["true", "верно", "правда", "дұрыс", "иә", "yes"]);
  const falsy = new Set(["false", "неверно", "ложь", "бұрыс", "жоқ", "no"]);
  const [trueLabel, falseLabel] = TRUE_FALSE_OPTIONS[language];
  if (truthy.has(normalized)) return trueLabel;
  if (falsy.has(normalized)) return falseLabel;
  return "";
}

function toQuestion(
  value: unknown,
  input: GenerateInput,
  difficulty: string,
  index: number,
): Question {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawOptions = Array.isArray(source.options)
    ? source.options.map((option) => String(option).trim()).filter(Boolean)
    : [];
  const options = input.type === "true_false"
    ? [...TRUE_FALSE_OPTIONS[input.language]]
    : [...new Set(rawOptions)];
  const rawAnswer = String(source.correct_answer || "").trim();
  const correctAnswer = input.type === "true_false"
    ? canonicalTrueFalse(rawAnswer, input.language)
    : rawAnswer;

  return {
    id: `${difficulty}-${index + 1}`,
    type: input.type,
    question: String(source.question || "").trim(),
    options: input.type === "multiple_choice" || input.type === "true_false" ? options : undefined,
    pairs: Array.isArray(source.pairs)
      ? source.pairs.map((pair) => {
          const item = pair && typeof pair === "object" ? pair as Record<string, unknown> : {};
          return { left: String(item.left || "").trim(), right: String(item.right || "").trim() };
        }).filter((pair) => pair.left && pair.right)
      : undefined,
    correct_answer: input.type === "matching" ? "" : correctAnswer,
    explanation: String(source.explanation || "").trim(),
    skill_tag: String(source.skill_tag || input.topic).trim(),
  };
}

async function requestVariant(input: GenerateInput, difficulty: string): Promise<TestVariant> {
  const apiKey = process.env.GROQ_API_KEY?.replace(/\s+/g, "");
  if (!apiKey) throw new GroqGenerationError("configuration", "GROQ_API_KEY is not configured.");
  const prompt = `Create ${input.count} UNIQUE ${input.type} school questions on "${input.topic}".
Language: ${input.language}. Grade: ${input.gradeLevel || "school"}. Difficulty: ${difficulty}.
Learning objective: ${input.objective || "understand and apply the topic"}.
${input.sourceText ? `Use this source as primary context: ${input.sourceText.slice(0, 12000)}` : ""}
Return only a JSON object with title, instructions, questions. The questions array MUST contain exactly ${input.count} items. Every question must contain id, type,
question, correct_answer, explanation, skill_tag. Multiple choice: 4 distinct options including
correct_answer. True/false: use exactly ${TRUE_FALSE_OPTIONS[input.language].join(" and ")} and make correct_answer one of them. Matching: pairs array
of objects with left and right plus correct_answer as an empty string. Short answer: concise model answer.
Do not repeat questions, do not include unsupported facts, keep the answer unambiguous.`;
  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
        temperature: 0.35,
        max_completion_tokens: 8192,
        reasoning_effort: "low",
        reasoning_format: "hidden",
        response_format: {
          type: "json_schema",
          json_schema: { name: "test_variant", strict: true, schema: responseSchema(input) },
        },
        messages: [{ role: "system", content: "You are a careful school assessment author. Output valid JSON only." }, { role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new GroqGenerationError("timeout", "Groq request timed out.");
    }
    console.error("Groq network request failed", { code: networkErrorCode(error) });
    throw new GroqGenerationError("upstream", "Groq could not be reached.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new GroqGenerationError("authentication", "Groq rejected the API key.");
    }
    if (response.status === 429) {
      throw new GroqGenerationError("rate_limit", "Groq rate limit exceeded.");
    }
    throw new GroqGenerationError("upstream", `Groq request failed (${response.status}).`);
  }
  let raw: Record<string, unknown>;
  try {
    const payload = await response.json();
    raw = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
  } catch {
    throw new GroqGenerationError("invalid_response", "Groq returned invalid JSON.");
  }
  const variant: TestVariant = {
    title: String(raw.title || `${input.topic} test`).slice(0, 180),
    instructions: String(raw.instructions || "Answer each question.").slice(0, 500),
    questions: Array.isArray(raw.questions)
      ? raw.questions.slice(0, input.count).map((question, index) => toQuestion(question, input, difficulty, index))
      : [],
  };
  if (!isValidVariant(variant) || variant.questions.length !== input.count || variant.questions.some((q) => !q.question)) {
    throw new GroqGenerationError("invalid_response", "AI returned an incomplete test.");
  }
  return variant;
}

async function generateVariant(input: GenerateInput, difficulty: string): Promise<TestVariant> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= generationAttempts(); attempt += 1) {
    try {
      return await requestVariant(input, difficulty);
    } catch (error) {
      lastError = error;
      if (!(error instanceof GroqGenerationError) || error.reason !== "invalid_response") throw error;
      console.warn("Groq returned an incomplete variant", { difficulty, attempt });
    }
  }
  throw lastError instanceof GroqGenerationError
    ? lastError
    : new GroqGenerationError("invalid_response", "Groq returned an incomplete test.");
}

export async function generateVariants(input: GenerateInput): Promise<Record<string, TestVariant>> {
  // Sequential requests avoid exhausting low-tier Groq request limits during retries.
  const easy = await generateVariant(input, "easy");
  const medium = await generateVariant(input, "medium");
  const hard = await generateVariant(input, "hard");
  const sources = [easy, medium, hard];
  const mixed: TestVariant = {
    title: `${medium.title} — mixed`,
    instructions: medium.instructions,
    questions: Array.from({ length: input.count }, (_, index) => ({
      ...sources[index % 3].questions[index],
      id: `mixed-${index + 1}`,
    })),
  };
  return { "Variant A": easy, "Variant B": medium, "Variant C": hard, "Variant D": mixed };
}
