import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { data, error } = await adminClient().from("web_tests")
    .select("id,title,topic,language,grade_level,status,created_at,updated_at")
    .eq("owner_id", actor.id).order("created_at", { ascending: false }).limit(200);
  if (error) return jsonError("Could not load the test library.", 503);
  return Response.json({ tests: data || [] });
}
