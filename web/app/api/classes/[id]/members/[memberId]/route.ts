import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { userClient } from "@/lib/supabase";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id, memberId } = await params;
  const { data, error } = await userClient(actor.accessToken).from("web_class_members")
    .delete().eq("id", memberId).eq("class_id", id).select("id").maybeSingle();
  if (error || !data) return jsonError("Student entry not found.", 404);
  return Response.json({ removed: true });
}
