import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { normalizedClassEmails, normalizedClassName } from "@/lib/classes";
import { userClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { data, error } = await userClient(actor.accessToken).from("web_classes")
    .select("id,name,is_active,created_at,web_class_members(id,email,student_id,created_at)")
    .eq("owner_id", actor.id).order("created_at", { ascending: false });
  if (error) return jsonError("Could not load classes. Apply the school-classes database migration first.", 503);
  return Response.json({ classes: data || [] });
}

export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  let body: { name?: unknown; emails?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const name = normalizedClassName(body.name);
  if (!name) return jsonError("Class name must be between 1 and 48 characters.");
  const emails = body.emails === undefined ? [] : normalizedClassEmails(body.emails);
  if (!emails) return jsonError("Add up to 100 valid email addresses.");

  const db = userClient(actor.accessToken);
  const { data: classRow, error: classError } = await db.from("web_classes")
    .insert({ owner_id: actor.id, name }).select("id,name,is_active,created_at").single();
  if (classError || !classRow) return jsonError("Could not create this class. Check whether its name is already used.", 409);
  if (emails.length) {
    const { error: membersError } = await db.from("web_class_members")
      .insert(emails.map((email) => ({ class_id: classRow.id, email })));
    if (membersError) {
      await db.from("web_classes").delete().eq("id", classRow.id).eq("owner_id", actor.id);
      return jsonError("Class was not created because its student list could not be saved.", 400);
    }
  }
  return Response.json({ class: classRow, member_count: emails.length }, { status: 201 });
}
