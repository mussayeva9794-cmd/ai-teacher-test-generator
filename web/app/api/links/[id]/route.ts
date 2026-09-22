import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  let body: { is_active?: boolean };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  if (typeof body.is_active !== "boolean") return jsonError("Invalid link status.");
  const { data, error } = await adminClient().from("web_share_links")
    .update({ is_active: body.is_active }).eq("id", id).eq("owner_id", actor.id)
    .select("id,is_active").maybeSingle();
  if (error || !data) return jsonError("Link not found.", 404);
  return Response.json({ link: data });
}
