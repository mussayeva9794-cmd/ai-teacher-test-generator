import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { normalizedClassEmails } from "@/lib/classes";
import { userClient } from "@/lib/supabase";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  let body: { emails?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const emails = normalizedClassEmails(body.emails);
  if (!emails || emails.length === 0) return jsonError("Add between 1 and 100 valid email addresses.");
  const db = userClient(actor.accessToken);
  const { data: classRow, error: classError } = await db.from("web_classes")
    .select("id").eq("id", id).eq("owner_id", actor.id).eq("is_active", true).maybeSingle();
  if (classError || !classRow) return jsonError("Active class not found.", 404);
  const rows = emails.map((email) => ({ class_id: id, email }));
  const { error } = await db.from("web_class_members").upsert(rows, {
    onConflict: "class_id,email", ignoreDuplicates: true,
  });
  if (error) return jsonError("Could not save the student list.", 503);
  return Response.json({ added_or_already_present: emails.length });
}
