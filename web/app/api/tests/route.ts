import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { userClient } from "@/lib/supabase";
import { isValidVariant } from "@/lib/question-validation";
import { MAX_REFERENCE_LENGTH } from "@/lib/dictation";
import { WRITTEN_KINDS, writtenKindLabel, writtenVariant, type WrittenKind } from "@/lib/written-work";

export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { data, error } = await userClient(actor.accessToken).from("web_tests")
    .select("id,title,topic,language,grade_level,status,created_at,updated_at")
    .eq("owner_id", actor.id).order("created_at", { ascending: false }).limit(200);
  if (error) return jsonError("Could not load the test library.", 503);
  return Response.json({ tests: data || [] });
}

/** Create a written work (dictation, word dictation, copying or essay) by hand; no AI is used. */
export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  let body: { kind?: unknown; language?: unknown; title?: unknown; gradeLevel?: unknown; text?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid written work."); }
  if (!(WRITTEN_KINDS as readonly unknown[]).includes(body.kind)) return jsonError("Choose the kind of work.");
  if (!["russian", "kazakh", "english"].includes(body.language as string)) return jsonError("Choose a language.");
  const kind = body.kind as WrittenKind;
  const language = body.language as "russian" | "kazakh" | "english";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 180) : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!title) return jsonError("Enter a title.");
  if (!text || text.length > MAX_REFERENCE_LENGTH) return jsonError("Enter the text of the work (up to 6000 characters).");
  const variant = writtenVariant(kind, language, title, text);
  if (!isValidVariant(variant)) return jsonError("Enter the text of the work (up to 6000 characters).");
  const { data, error } = await userClient(actor.accessToken).from("web_tests").insert({
    owner_id: actor.id, title, topic: writtenKindLabel(kind, language), language,
    grade_level: typeof body.gradeLevel === "string" ? body.gradeLevel.slice(0, 80) : "",
    variants: { "Variant A": variant }, status: "draft",
  }).select("id").single();
  if (error || !data) {
    console.error("Written work save failed", { code: error?.code || "unknown" });
    return jsonError("Could not save the work.", 503);
  }
  return Response.json({ id: data.id });
}
