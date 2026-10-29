import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { normalizedStudentName } from "@/lib/classes";
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

/** Sets or clears the name the teacher typed for one roster entry. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id, memberId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  // The field must be sent: null or "" clears the name, a missing field is an error.
  if (!body || typeof body !== "object" || Array.isArray(body) || !("full_name" in body)) return jsonError("Invalid request body.");
  const fullName = normalizedStudentName((body as { full_name: unknown }).full_name);
  if (fullName === undefined) return jsonError("Student name must be up to 120 characters and contain letters.");
  const db = userClient(actor.accessToken);
  const { data: classRow, error: classError } = await db.from("web_classes")
    .select("id").eq("id", id).eq("owner_id", actor.id).eq("is_active", true).maybeSingle();
  if (classError || !classRow) return jsonError("Active class not found.", 404);
  const { data, error } = await db.from("web_class_members")
    .update({ full_name: fullName }).eq("id", memberId).eq("class_id", id).select("id").maybeSingle();
  if (error || !data) return jsonError("Student entry not found.", 404);
  return Response.json({ full_name: fullName });
}
