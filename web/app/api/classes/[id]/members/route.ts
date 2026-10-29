import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { rosterFromBody } from "@/lib/classes";
import { userClient } from "@/lib/supabase";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  let body: { emails?: unknown; students?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const students = rosterFromBody(body);
  if (!students || students.length === 0) return jsonError("Add between 1 and 100 students with valid emails and names.");
  const db = userClient(actor.accessToken);
  const { data: classRow, error: classError } = await db.from("web_classes")
    .select("id").eq("id", id).eq("owner_id", actor.id).eq("is_active", true).maybeSingle();
  if (classError || !classRow) return jsonError("Active class not found.", 404);
  // A typed name replaces the stored one; an email without a name never
  // clears a name already in the roster.
  const named = students.filter((student) => student.full_name).map((student) => ({ class_id: id, ...student }));
  const unnamed = students.filter((student) => !student.full_name).map(({ email }) => ({ class_id: id, email }));
  for (const [rows, ignoreDuplicates] of [[named, false], [unnamed, true]] as const) {
    if (!rows.length) continue;
    const { error } = await db.from("web_class_members").upsert(rows, { onConflict: "class_id,email", ignoreDuplicates });
    if (error) return jsonError("Could not save the student list.", 503);
  }
  return Response.json({ added_or_already_present: students.length });
}
