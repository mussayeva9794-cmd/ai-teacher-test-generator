import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const admin = adminClient();
  const { data: test } = await admin.from("web_tests").select("id")
    .eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (!test) return jsonError("Test not found.", 404);
  const { data: attempts, error } = await admin.from("web_attempts")
    .select("id,student_id,variant_name,percentage,answers,result,submitted_at")
    .eq("test_id", id).order("submitted_at", { ascending: false }).limit(500);
  if (error) return jsonError("Could not load results.", 503);
  const ids = [...new Set((attempts || []).map((row) => row.student_id))];
  const { data: profiles } = ids.length
    ? await admin.from("web_profiles").select("id,display_name").in("id", ids)
    : { data: [] as { id: string; display_name: string }[] };
  const names = new Map((profiles || []).map((profile) => [profile.id, profile.display_name]));
  const rows = (attempts || []).map((row) => ({ ...row, student_name: names.get(row.student_id) || "Student" }));
  const average = rows.length ? rows.reduce((sum, row) => sum + Number(row.percentage), 0) / rows.length : 0;
  return Response.json({ attempts: rows, summary: { count: rows.length, average: Math.round(average * 100) / 100 } });
}
