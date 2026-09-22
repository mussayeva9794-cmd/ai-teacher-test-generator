import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { generateVariants, type GenerateInput } from "@/lib/groq";
import { adminClient } from "@/lib/supabase";

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
  try {
    const variants = await generateVariants({
      topic, count, type: body.type, language: body.language,
      gradeLevel: String(body.gradeLevel || "").slice(0, 80),
      objective: String(body.objective || "").slice(0, 1000),
      sourceText: String(body.sourceText || "").slice(0, 12000),
    });
    const { data, error } = await adminClient().from("web_tests").insert({
      owner_id: actor.id, title: variants["Variant B"].title, topic,
      language: body.language, grade_level: String(body.gradeLevel || "").slice(0, 80),
      variants, status: "draft",
    }).select("id").single();
    if (error || !data) throw error || new Error("Test save failed.");
    return Response.json({ id: data.id });
  } catch (error) {
    console.error("Generation failed", error);
    return jsonError("Generation could not finish. Check Groq configuration and retry.", 503);
  }
}
