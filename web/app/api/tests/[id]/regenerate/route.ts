import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { generateQuestion, GroqGenerationError, type GenerateInput } from "@/lib/groq";
import { releaseGenerationWindow, reserveGenerationWindow } from "@/lib/generation-quota";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";
import type { TestRow } from "@/lib/types";

export const maxDuration = 120;

// Variants A–C are written at fixed difficulties; the mixed variant D reuses
// questions from all three, so its ids keep the original difficulty prefix.
const VARIANT_DIFFICULTY: Record<string, string> = { "Variant A": "easy", "Variant B": "medium", "Variant C": "hard" };
const LANGUAGES = ["russian", "kazakh", "english"] as const;

/**
 * Write one replacement question. Nothing is saved here: the teacher sees the
 * new question in the editor and keeps it by saving the test.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  let body: { variant_name?: unknown; question_id?: unknown; question?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.variant_name !== "string" || typeof body.question_id !== "string") return jsonError("Invalid request body.");
  const db = userClient(actor.accessToken);
  const { data, error } = await db.from("web_tests").select("id,topic,language,grade_level,variants")
    .eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (error || !data) return jsonError("Test not found.", 404);
  const test = data as Pick<TestRow, "id" | "topic" | "language" | "grade_level" | "variants">;
  // Only the test's own variants; never inherited names such as "__proto__".
  const variant = test.variants && typeof test.variants === "object" && Object.hasOwn(test.variants, body.variant_name)
    ? test.variants[body.variant_name] : undefined;
  // The editor may hold unsaved edits, so it sends the wording it shows; the
  // saved question decides only the type and skill.
  const saved = Array.isArray(variant?.questions) ? variant.questions.find((question) => question?.id === body.question_id) : undefined;
  if (!variant || !saved) return jsonError("Question not found.", 404);
  const language = (LANGUAGES as readonly string[]).includes(test.language) ? test.language as GenerateInput["language"] : "russian";
  const difficulty = VARIANT_DIFFICULTY[body.variant_name] || saved.id.split("-")[0] || "medium";
  const current = typeof body.question === "string" ? body.question.slice(0, 1000) : saved.question;

  const reservation = await reserveGenerationWindow(db);
  if (reservation.status !== "allowed") {
    return reservation.status === "limited"
      ? jsonError("Generation limit reached: 5 requests per hour. Try later.", 429)
      : jsonError("Generation is temporarily unavailable. Check the database migration.", 503);
  }
  try {
    const question = await generateQuestion({
      topic: test.topic, type: saved.type, language,
      gradeLevel: test.grade_level || "", objective: saved.skill_tag || "",
      avoid: [current, ...variant.questions.filter((item) => item.id !== saved.id).map((item) => item.question)],
    }, ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "medium");
    const taken = new Set(variant.questions.map((item) => item.id));
    let newId = "";
    do newId = `${difficulty}-r${crypto.randomUUID().slice(0, 8)}`; while (taken.has(newId));
    return Response.json({ question: { ...question, id: newId, skill_tag: saved.skill_tag || question.skill_tag } });
  } catch (cause) {
    await releaseGenerationWindow(adminClient, actor.id, reservation.window);
    const reason = cause instanceof GroqGenerationError ? cause.reason : "upstream";
    console.error("Question regeneration failed", { reason });
    if (reason === "rate_limit") return jsonError("Groq request limit was reached. Wait one minute and retry.", 429);
    if (reason === "timeout") return jsonError("Groq took too long to answer. Retry the generation.", 503);
    if (reason === "invalid_response") return jsonError("AI returned an incomplete test. Retry or add more source material.", 503);
    return jsonError("Groq is temporarily unavailable. Retry shortly.", 503);
  }
}
