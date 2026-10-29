import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { adminClient } from "@/lib/supabase-admin";
import { myAttempts, type MyAttemptRow, type MyLinkRow, type MyTestRow } from "@/lib/my-attempts";

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
  const [{ data: tests, error: testsError }, { data: links, error: linksError }] = await Promise.all([
    admin.from("web_tests").select("id,title,topic,status").in("id", [...new Set(rows.map((row) => row.test_id))]),
    admin.from("web_share_links").select("id,token,settings,is_active").in("id", [...new Set(rows.map((row) => row.link_id))]),
  ]);
  if (testsError || linksError) return jsonError("Could not load your tests.", 503);
  return Response.json({ attempts: myAttempts(rows, (tests || []) as MyTestRow[], (links || []) as MyLinkRow[]) });
}
