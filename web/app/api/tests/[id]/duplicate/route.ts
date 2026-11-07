import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { userClient } from "@/lib/supabase";

const COPY_WORD: Record<string, string> = { russian: "копия", kazakh: "көшірме", english: "copy" };

// A private draft copy of one of the teacher's own tests: no links, no results.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const db = userClient(actor.accessToken);
  const { data: source, error: sourceError } = await db.from("web_tests")
    .select("title,topic,language,grade_level,variants").eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (sourceError) return jsonError("Could not load the test.", 503);
  if (!source) return jsonError("Test not found.", 404);
  const { data, error } = await db.from("web_tests").insert({
    owner_id: actor.id, title: `${source.title} (${COPY_WORD[source.language] || "copy"})`.slice(0, 180), topic: source.topic,
    language: source.language, grade_level: source.grade_level, variants: source.variants, status: "draft",
  }).select("id").single();
  if (error || !data) {
    console.error("Test duplication failed", { code: error?.code || "unknown" });
    return jsonError("Could not duplicate the test.", 503);
  }
  return Response.json({ id: data.id });
}
