import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { normalizedClassName, rosterFromBody } from "@/lib/classes";
import { userClient } from "@/lib/supabase";
import { profileNames } from "@/lib/student-lookup";
import { studentIdentity } from "@/lib/student-names";

export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { data, error } = await userClient(actor.accessToken).from("web_classes")
    .select("id,name,is_active,created_at,web_class_members(id,email,full_name,student_id,created_at)")
    .eq("owner_id", actor.id).order("created_at", { ascending: false });
  if (error) return jsonError("Could not load classes. Apply the school-classes database migration first.", 503);
  const classes = data || [];
  // Names of students in this teacher's own rosters; the list still loads without them.
  const ids = classes.flatMap((row) => row.web_class_members.flatMap((member) => member.student_id ? [member.student_id as string] : []));
  const names = ids.length ? await profileNames(ids).catch(() => null) : null;
  return Response.json({ classes: classes.map((row) => ({
    ...row,
    web_class_members: row.web_class_members.map((member) => {
      const shown = studentIdentity(member.student_id ? names?.get(member.student_id) : null, member.email, member.full_name);
      return { ...member, name: shown.email ? shown.name : null };
    }),
  })) });
}

export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  let body: { name?: unknown; emails?: unknown; students?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const name = normalizedClassName(body.name);
  if (!name) return jsonError("Class name must be between 1 and 48 characters.");
  const students = body.emails === undefined && body.students === undefined ? [] : rosterFromBody(body);
  if (!students) return jsonError("Add up to 100 students with valid emails and names.");

  const db = userClient(actor.accessToken);
  const { data: classRow, error: classError } = await db.from("web_classes")
    .insert({ owner_id: actor.id, name }).select("id,name,is_active,created_at").single();
  if (classError || !classRow) return jsonError("Could not create this class. Check whether its name is already used.", 409);
  if (students.length) {
    const { error: membersError } = await db.from("web_class_members")
      .insert(students.map((student) => ({ class_id: classRow.id, ...student })));
    if (membersError) {
      await db.from("web_classes").delete().eq("id", classRow.id).eq("owner_id", actor.id);
      return jsonError("Class was not created because its student list could not be saved.", 400);
    }
  }
  return Response.json({ class: classRow, member_count: students.length }, { status: 201 });
}
