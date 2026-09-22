import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { generateVariants, GroqGenerationError, type GenerateInput } from "@/lib/groq";
import { userClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  let body: Partial<GenerateInput>;
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const topic = String(body.topic || "").trim();
  const count = Number(body.count);
  if (!topic || topic.length > 180 || !Number.isInteger(count) || count < 1 || count > 20) {
    return jsonError("Enter a topic and choose 1–20 questions.");
  }
  if (!body.type || !["multiple_choice", "true_false", "short_answer", "matching"].includes(body.type)) {
    return jsonError("Choose a supported question type.");
  }
  if (!body.language || !["russian", "kazakh", "english"].includes(body.language)) {
    return jsonError("Choose a language.");
  }
  let variants;
  try {
    variants = await generateVariants({
      topic, count, type: body.type, language: body.language,
      gradeLevel: String(body.gradeLevel || "").slice(0, 80),
      objective: String(body.objective || "").slice(0, 1000),
      sourceText: String(body.sourceText || "").slice(0, 12000),
    });
  } catch (error) {
    const reason = error instanceof GroqGenerationError ? error.reason : "upstream";
    console.error("Generation failed", { reason });
    const messages = {
      configuration: "Groq is not configured on the server.",
      authentication: "Groq rejected the API key. Replace GROQ_API_KEY in Vercel and redeploy.",
      rate_limit: "Groq request limit was reached. Wait one minute and retry.",
      timeout: "Groq took too long to answer. Retry the generation.",
      upstream: "Groq is temporarily unavailable. Retry shortly.",
      invalid_response: "AI returned an incomplete test. Retry or add more source material.",
    } as const;
    return jsonError(messages[reason], reason === "rate_limit" ? 429 : 503);
  }

  const { data, error } = await userClient(actor.accessToken).from("web_tests").insert({
    owner_id: actor.id, title: variants["Variant B"].title, topic,
    language: body.language, grade_level: String(body.gradeLevel || "").slice(0, 80),
    variants, status: "draft",
  }).select("id").single();
  if (error || !data) {
    console.error("Generated test save failed", { code: error?.code || "unknown" });
    return jsonError("The test was generated but could not be saved. Check Supabase access policies.", 503);
  }
  return Response.json({ id: data.id });
}
