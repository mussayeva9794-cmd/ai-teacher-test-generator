import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { isValidVariant } from "@/lib/assessment";
import { adminClient } from "@/lib/supabase";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const { data, error } = await adminClient().from("web_tests")
    .select("*").eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (error || !data) return jsonError("Test not found.", 404);
  return Response.json({ test: data });
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  let body: { variants?: unknown; status?: string; title?: string };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.variants !== undefined) {
    if (!body.variants || typeof body.variants !== "object" ||
        !Object.values(body.variants).every(isValidVariant) || Object.keys(body.variants).length !== 4) {
      return jsonError("Every variant must contain valid questions.");
    }
    patch.variants = body.variants;
  }
  if (body.status !== undefined) {
    if (!["draft", "published", "archived"].includes(body.status)) return jsonError("Invalid status.");
    patch.status = body.status;
  }
  if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, 180);
  const { data, error } = await adminClient().from("web_tests").update(patch)
    .eq("id", id).eq("owner_id", actor.id).select("id,status").maybeSingle();
  if (error || !data) return jsonError("Test could not be updated.", 503);
  return Response.json({ test: data });
}
