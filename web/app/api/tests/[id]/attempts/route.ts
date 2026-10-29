import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";
import { studentProfiles } from "@/lib/student-lookup";
import { rosterNameFor, rosterNames } from "@/lib/roster-names";
import { studentIdentity } from "@/lib/student-names";
import { spreadsheetSafeText } from "@/lib/csv-export";
import { isMissingClassSchema } from "@/lib/schema-compat";

type IntegrityRow = {
  link_id: string; student_id: string; leaves: number; pastes: number; copies: number;
  auto_submitted: boolean; away_seconds: number; question_seconds: Record<string, number>;
};

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
    .select("id,link_id,student_id,variant_name,percentage,answers,result,submitted_at", { count: "exact" })
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
        .select("id,link_id,student_id,variant_name,percentage,answers,result,submitted_at")
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
  const studentIds = (attempts || []).map((row) => row.student_id);
  const [profiles, roster, { data: links, error: linksError }] = await Promise.all([
    studentProfiles(studentIds),
    rosterNames(db, studentIds),
    db.from("web_share_links").select("id,class_id").eq("test_id", id),
  ]);
  // Without the class migrations links have no class; names come from profiles.
  const classesMissing = isMissingClassSchema(linksError);
  if (!profiles || !roster || (linksError && !classesMissing)) return jsonError("Could not load student display names.", 503);
  // The name the teacher typed in the class roster comes before the profile name.
  const typedName = rosterNameFor(roster);
  const linkClass = new Map((classesMissing ? [] : links || []).map((link) => [link.id as string, link.class_id as string | null]));
  // Strict-mode signals are optional: an older database without the
  // integrity migration still returns results, just without these counters.
  const integrity = new Map<string, IntegrityRow>();
  if (attempts.length) {
    const { data: integrityRows, error: integrityError } = await adminClient()
      .rpc("web_attempt_integrity_summary", { p_test_id: id });
    if (integrityError) console.error("Integrity summary failed", { code: integrityError.code });
    for (const item of (integrityRows || []) as IntegrityRow[]) integrity.set(`${item.link_id}:${item.student_id}`, item);
  }
  const rows = (attempts || []).map((row) => {
    const profile = profiles.get(row.student_id);
    const identity = studentIdentity(profile?.name, profile?.email, typedName(row.student_id, linkClass.get(row.link_id)));
    const signals = integrity.get(`${row.link_id}:${row.student_id}`);
    return {
      ...row,
      integrity: signals ? {
        leaves: signals.leaves, pastes: signals.pastes, copies: signals.copies, auto_submitted: signals.auto_submitted,
        away_seconds: signals.away_seconds, question_seconds: signals.question_seconds,
      } : null,
      student_name: identity.name,
      student_email: identity.email,
      // Keep the display name intact; exports use this spreadsheet-safe form.
      csv_student_name: spreadsheetSafeText(identity.name),
      csv_student_email: spreadsheetSafeText(identity.email ?? ""),
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
