import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { BLOOM_MIXES, generateRubrics, generateVariants, GroqGenerationError, type BloomMix, type GenerateInput } from "@/lib/groq";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";
import { QUESTION_TYPES } from "@/lib/question-validation";
import { quotaErrorResponse, releaseGenerationWindow, reserveGenerationWindow } from "@/lib/generation-quota";

export const maxDuration = 300;
// The СОР/СОЧ table is skipped when generation already took this long, so the
// table call plus its fallback cannot push the request past maxDuration.
const RUBRIC_DEADLINE_MS = 170_000;

export async function POST(request: NextRequest) {
  const started = Date.now();
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  // Source details arrive as flat form fields and are folded into `sources` below.
  let body: Partial<GenerateInput> & { sourceTitle?: unknown; sourcePages?: unknown; sourceUrl?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const topic = String(body.topic || "").trim();
  const count = Number(body.count);
  if (!topic || topic.length > 180 || !Number.isInteger(count) || count < 1 || count > 20) {
    return jsonError("Enter a topic and choose 1–20 questions.");
  }
  if (!body.type || !(body.type === "mixed" || (QUESTION_TYPES as readonly string[]).includes(body.type))) {
    return jsonError("Choose a supported question type.");
  }
  if (!body.language || !["russian", "kazakh", "english"].includes(body.language)) {
    return jsonError("Choose a language.");
  }
  const bloomMix: BloomMix = typeof body.bloomMix === "string" && Object.hasOwn(BLOOM_MIXES, body.bloomMix) ? body.bloomMix : "balanced";
  const format = body.format === "sor" || body.format === "soch" ? body.format : "test";
  const sourceText = String(body.sourceText || "").trim().slice(0, 12000);
  const sourceTitle = String(body.sourceTitle || "").trim().slice(0, 180);
  const sourcePages = String(body.sourcePages || "").trim().slice(0, 120);
  const sourceUrl = String(body.sourceUrl || "").trim().slice(0, 500);
  if ((sourceTitle || sourcePages || sourceUrl) && !sourceText) {
    return jsonError("Add the source text before adding source details.");
  }
  if (sourceUrl) {
    try {
      if (new URL(sourceUrl).protocol !== "https:") throw new Error("Only HTTPS URLs are allowed.");
    } catch {
      return jsonError("Source URL must be a valid HTTPS address.");
    }
  }
  const db = userClient(actor.accessToken);
  const reservation = await reserveGenerationWindow(db);
  if (reservation.status !== "allowed") return quotaErrorResponse(reservation);
  const { window } = reservation;
  const releaseQuota = () => releaseGenerationWindow(adminClient, actor.id, window);
  const input: GenerateInput = {
    topic, count, type: body.type, language: body.language,
    gradeLevel: String(body.gradeLevel || "").slice(0, 80),
    objective: String(body.objective || "").slice(0, 1000),
    sourceText, bloomMix, format,
    sources: sourceText ? [{
      label: sourceTitle || "Материал, добавленный преподавателем",
      ...(sourcePages ? { pages: sourcePages } : {}),
      ...(sourceUrl ? { url: sourceUrl } : {}),
    }] : [],
  };
  let variants;
  try {
    variants = await generateVariants(input);
  } catch (error) {
    const reason = error instanceof GroqGenerationError ? error.reason : "upstream";
    console.error("Generation failed", {
      reason,
      upstreamStatus: error instanceof GroqGenerationError ? error.upstreamStatus : undefined,
    });
    const messages = {
      configuration: "Сервис генерации не настроен. Сообщите администратору.",
      authentication: "Сервис генерации требует проверки администратором. Попробуйте позже.",
      rate_limit: "Groq request limit was reached. Wait one minute and retry.",
      timeout: "Groq took too long to answer. Retry the generation.",
      upstream: "Groq is temporarily unavailable. Retry shortly.",
      invalid_response: "AI returned an incomplete test. Retry or add more source material.",
    } as const;
    await releaseQuota();
    return jsonError(messages[reason], reason === "rate_limit" ? 429 : 503);
  }

  if (format !== "test" && Date.now() - started < RUBRIC_DEADLINE_MS) {
    // The criteria table is an extra; a failure here still returns the test.
    try {
      const rubrics = await generateRubrics(input, variants);
      for (const [name, assessment] of Object.entries(rubrics)) variants[name] = { ...variants[name], assessment };
    } catch (error) {
      console.error("Rubric generation failed", { reason: error instanceof GroqGenerationError ? error.reason : "upstream" });
    }
  }

  const { data, error } = await db.from("web_tests").insert({
    owner_id: actor.id, title: variants["Variant B"].title, topic,
    language: body.language, grade_level: String(body.gradeLevel || "").slice(0, 80),
    variants, status: "draft",
  }).select("id").single();
  if (error || !data) {
    console.error("Generated test save failed", { code: error?.code || "unknown" });
    await releaseQuota();
    return jsonError("The test was generated but could not be saved. Check Supabase access policies.", 503);
  }
  return Response.json({ id: data.id });
}
