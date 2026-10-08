import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";
import { spreadsheetSafeText } from "@/lib/csv-export";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const pageSize = 50;
  const requestedPage = Number(request.nextUrl.searchParams.get("page") || 0);
  const exportAll = request.nextUrl.searchParams.get("all") === "true";
  if (!Number.isInteger(requestedPage) || requestedPage < 0 || requestedPage > 10000) {
    return jsonError("Invalid results page.", 400);
  }
  const db = userClient(actor.accessToken);
  const { data: test } = await db.from("web_tests").select("id")
    .eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (!test) return jsonError("Test not found.", 404);
  const { data: pageAttempts, error, count } = await db.from("web_attempts")
    .select("id,student_id,variant_name,percentage,answers,result,submitted_at", { count: "exact" })
    .eq("test_id", id).order("submitted_at", { ascending: false }).order("id", { ascending: false })
    .range(requestedPage * pageSize, requestedPage * pageSize + pageSize - 1);
  if (error) return jsonError("Could not load results.", 503);
  const total = count || 0;
  if (exportAll && total > 20000) return jsonError("CSV export is limited to 20,000 attempts; contact support for a larger export.", 413);

  let attempts = pageAttempts || [];
  if (exportAll) {
    const allRows = [] as typeof attempts;
    let cursor: { submitted_at: string; id: string } | null = null;
    while (true) {
      let query = db.from("web_attempts")
        .select("id,student_id,variant_name,percentage,answers,result,submitted_at")
        .eq("test_id", id).order("submitted_at", { ascending: false })
        .order("id", { ascending: false }).limit(1000);
      if (cursor) {
        query = query.or(`submitted_at.lt.${cursor.submitted_at},and(submitted_at.eq.${cursor.submitted_at},id.lt.${cursor.id})`);
      }
      const { data, error: pageError } = await query;
      if (pageError) return jsonError("Could not load all results for export.", 503);
      const batch = data || [];
      if (allRows.length + batch.length > 20000) return jsonError("CSV export is limited to 20,000 attempts; contact support for a larger export.", 413);
      allRows.push(...batch);
      if (batch.length < 1000) break;
      const last = batch[batch.length - 1];
      cursor = { submitted_at: last.submitted_at, id: last.id };
    }
    attempts = allRows;
  }
  const ids = [...new Set((attempts || []).map((row) => row.student_id))];
  const names = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data: profiles, error: profileError } = await adminClient().from("web_profiles")
      .select("id,display_name").in("id", ids.slice(offset, offset + 100));
    if (profileError) return jsonError("Could not load student display names.", 503);
    for (const profile of profiles || []) names.set(profile.id, profile.display_name);
  }
  const rows = (attempts || []).map((row) => {
    const studentName = names.get(row.student_id) || "Student";
    return {
      ...row,
      student_name: studentName,
      // Keep the display name intact; exports use this spreadsheet-safe form.
      csv_student_name: spreadsheetSafeText(studentName),
    };
  });
  const { data: summaryRows, error: summaryError } = await db.rpc("web_test_attempt_summary", { p_test_id: id });
  if (summaryError) return jsonError("Results summary is not configured. Apply the school results-summary migration.", 503);
  const summary = summaryRows?.[0] || { total_count: 0, graded_count: 0, pending_review: 0, average: 0 };
  return Response.json({ attempts: rows, summary: {
    count: Number(summary.total_count),
    graded_count: Number(summary.graded_count),
    pending_review: Number(summary.pending_review),
    average: Number(summary.average),
  }, page: requestedPage, page_size: pageSize, total_pages: Math.ceil(total / pageSize), has_more: requestedPage + 1 < Math.ceil(total / pageSize) });
}
