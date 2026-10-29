import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { adminClient } from "@/lib/supabase-admin";
import { myAttempts, type MyAttemptRow, type MyLinkRow, type MyTestRow } from "@/lib/my-attempts";
import { parseSettings } from "@/lib/assessment";
import { isMissingClassSchema } from "@/lib/schema-compat";
import { isAllowedByEmailList } from "@/lib/share-access";

const MAX_SHOWN = 200;

/** The signed-in student's own submitted tests, newest first. */
export async function GET(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor) return jsonError("Sign in with a student account.", 401);
  if (actor.role !== "student") return jsonError("Student account required.", 403);
  let admin: ReturnType<typeof adminClient>;
  try { admin = adminClient(); }
  catch { return jsonError("Could not load your tests.", 503); }
  // Students cannot read attempts under row-level security, so the server
  // reads them for exactly this student and returns only what the test page would.
  const { data: attempts, error } = await admin.from("web_attempts")
    .select("id,test_id,link_id,percentage,submitted_at").eq("student_id", actor.id)
    .order("submitted_at", { ascending: false }).limit(MAX_SHOWN);
  if (error) return jsonError("Could not load your tests.", 503);
  const rows = (attempts || []) as MyAttemptRow[];
  if (!rows.length) return Response.json({ attempts: [] });
  const [{ data: tests, error: testsError }, linkResult] = await Promise.all([
    admin.from("web_tests").select("id,title,topic,status").in("id", [...new Set(rows.map((row) => row.test_id))]),
    loadLinks(admin, [...new Set(rows.map((row) => row.link_id))]),
  ]);
  if (testsError || !linkResult) return jsonError("Could not load your tests.", 503);
  const links = linkResult;
  // The result link is offered only where the test page would let this student in again.
  const classIds = [...new Set(links.map((link) => link.class_id).filter((id): id is string => Boolean(id)))];
  let openClasses = new Set<string>();
  if (classIds.length && actor.googleEmail) {
    const [{ data: classes, error: classError }, { data: members, error: memberError }, { data: invites, error: inviteError }] = await Promise.all([
      admin.from("web_classes").select("id,is_active").in("id", classIds),
      admin.from("web_class_members").select("class_id,email").in("class_id", classIds).eq("student_id", actor.id),
      // Removed and added again by email: the test page claims this invite on the next visit.
      admin.from("web_class_members").select("class_id").in("class_id", classIds).eq("email", actor.googleEmail).is("student_id", null),
    ]);
    if (classError || memberError || inviteError) return jsonError("Could not load your tests.", 503);
    const active = new Set((classes || []).filter((row) => row.is_active).map((row) => row.id as string));
    // Same rules as shareContext: an own roster row must carry this Google email;
    // without one, an unclaimed invite for this email lets the student in.
    const own = new Map((members || []).map((row) => [row.class_id as string, row.email as string]));
    const invited = new Set((invites || []).map((row) => row.class_id as string));
    openClasses = new Set(classIds.filter((id) => active.has(id) &&
      (own.has(id) ? own.get(id) === actor.googleEmail : invited.has(id))));
  }
  const canOpen = (link: MyLinkRow) => link.class_id
    ? actor.hasGoogleIdentity && openClasses.has(link.class_id)
    : isAllowedByEmailList(actor.email, actor.emailVerified, parseSettings(link.settings).allowed_students);
  return Response.json({ attempts: myAttempts(rows, (tests || []) as MyTestRow[], links, canOpen) });
}

/** Share links by id; a database without the class migration has no class_id column. */
async function loadLinks(admin: ReturnType<typeof adminClient>, ids: string[]): Promise<MyLinkRow[] | null> {
  const withClass = await admin.from("web_share_links").select("id,token,settings,is_active,class_id").in("id", ids);
  if (!withClass.error) return (withClass.data || []) as MyLinkRow[];
  if (!isMissingClassSchema(withClass.error)) return null;
  const { data, error } = await admin.from("web_share_links").select("id,token,settings,is_active").in("id", ids);
  return error ? null : (data || []) as MyLinkRow[];
}
