import type { Question, QuestionType, TestVariant } from "./types";
import { isValidVariant } from "./assessment";

export type GenerateInput = {
  topic: string;
  count: number;
  type: QuestionType;
  language: "russian" | "kazakh" | "english";
  gradeLevel: string;
  objective: string;
  sourceText?: string;
};

async function generateVariant(input: GenerateInput, difficulty: string): Promise<TestVariant> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
  const prompt = `Create ${input.count} UNIQUE ${input.type} school questions on "${input.topic}".
Language: ${input.language}. Grade: ${input.gradeLevel || "school"}. Difficulty: ${difficulty}.
Learning objective: ${input.objective || "understand and apply the topic"}.
${input.sourceText ? `Use this source as primary context: ${input.sourceText.slice(0, 12000)}` : ""}
Return only a JSON object with title, instructions, questions. Every question must contain id, type,
question, correct_answer, explanation, skill_tag. Multiple choice: 4 distinct options including
correct_answer. True/false: 2 localized options including correct_answer. Matching: pairs array
of objects with left and right plus correct_answer as an empty string. Short answer: concise model answer.
Do not repeat questions, do not include unsupported facts, keep the answer unambiguous.`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      temperature: 0.55,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: "You are a careful school assessment author. Output valid JSON only." }, { role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Groq request failed (${response.status}).`);
  const payload = await response.json();
  const raw = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
  const variant: TestVariant = {
    title: String(raw.title || `${input.topic} test`).slice(0, 180),
    instructions: String(raw.instructions || "Answer each question.").slice(0, 500),
    questions: Array.isArray(raw.questions) ? raw.questions.slice(0, input.count).map((q: Record<string, unknown>, index: number): Question => ({
      id: `${difficulty}-${index + 1}`,
      type: input.type,
      question: String(q.question || "").trim(),
      options: Array.isArray(q.options) ? q.options.map(String) : undefined,
      pairs: Array.isArray(q.pairs) ? q.pairs.map((p: Record<string, unknown>) => ({ left: String(p.left || ""), right: String(p.right || "") })) : undefined,
      correct_answer: String(q.correct_answer || "").trim(),
      explanation: String(q.explanation || "").trim(),
      skill_tag: String(q.skill_tag || input.topic).trim(),
    })) : [],
  };
  if (!isValidVariant(variant) || variant.questions.length !== input.count || variant.questions.some((q) => !q.question)) {
    throw new Error("AI returned an incomplete test. Please retry or edit the source topic.");
  }
  return variant;
}

export async function generateVariants(input: GenerateInput): Promise<Record<string, TestVariant>> {
  const [easy, medium, hard] = await Promise.all([
    generateVariant(input, "easy"), generateVariant(input, "medium"), generateVariant(input, "hard"),
  ]);
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
