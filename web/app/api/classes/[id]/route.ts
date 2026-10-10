import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { normalizedClassName } from "@/lib/classes";
import { userClient } from "@/lib/supabase";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  let body: { name?: unknown; is_active?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const updates: { name?: string; is_active?: boolean } = {};
  if (body.name !== undefined) {
    const name = normalizedClassName(body.name);
    if (!name) return jsonError("Class name must be between 1 and 48 characters.");
    updates.name = name;
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") return jsonError("Invalid class status.");
    updates.is_active = body.is_active;
  }
  if (!Object.keys(updates).length) return jsonError("No class changes were provided.");
  const { data, error } = await userClient(actor.accessToken).from("web_classes")
    .update(updates).eq("id", id).eq("owner_id", actor.id)
    .select("id,name,is_active,created_at").maybeSingle();
  if (error || !data) return jsonError("Class not found or could not be updated.", 404);
  return Response.json({ class: data });
}
