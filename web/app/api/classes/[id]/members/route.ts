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
  // A typed name replaces the stored one; an email without a name keeps the
  // name already in the roster. One upsert, so the list is saved whole or not at all.
  const unnamed = students.filter((student) => !student.full_name).map((student) => student.email);
  const kept = new Map<string, string | null>();
  for (let offset = 0; offset < unnamed.length; offset += 100) {
    const { data, error } = await db.from("web_class_members").select("email,full_name")
      .eq("class_id", id).in("email", unnamed.slice(offset, offset + 100));
    if (error) return jsonError("Could not save the student list.", 503);
    for (const row of data || []) kept.set(row.email as string, row.full_name as string | null);
  }
  const rows = students.map((student) => ({ class_id: id, email: student.email, full_name: student.full_name ?? kept.get(student.email) ?? null }));
  const { error } = await db.from("web_class_members").upsert(rows, { onConflict: "class_id,email" });
  if (error) return jsonError("Could not save the student list.", 503);
  return Response.json({ added_or_already_present: students.length });
}
