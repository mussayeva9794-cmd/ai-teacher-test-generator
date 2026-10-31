import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { percentageOf } from "@/lib/assessment";
import { compareTexts, dictationRecord, isValidMarks, readDictationRecord } from "@/lib/dictation";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";

type Row = { id?: unknown; score?: unknown; points?: unknown; requires_manual_review?: unknown; dictation?: unknown };

/**
 * Save the teacher's marks on a dictation's mistakes (not counted, minor) and
 * grade it again. The grade is always worked out here from the stored text and
 * norms, never taken from the browser.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id: testId } = await params;
  const db = userClient(actor.accessToken);
  const { data: test, error: testError } = await db.from("web_tests").select("id")
    .eq("id", testId).eq("owner_id", actor.id).maybeSingle();
  if (testError) return jsonError("Could not verify test ownership.", 503);
  if (!test) return jsonError("Test not found.", 404);

  let body: { attempt_id?: unknown; question_id?: unknown; marks?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid dictation marks."); }
  if (typeof body.attempt_id !== "string" || !body.attempt_id || typeof body.question_id !== "string" || !body.question_id ||
    body.question_id.length > 100 || !body.marks || typeof body.marks !== "object" || Object.keys(body.marks).length > 3000) {
    return jsonError("Invalid dictation marks.");
  }

  const admin = adminClient();
  const { data: attempt, error: attemptError } = await admin.from("web_attempts")
    .select("id,answers,result").eq("id", body.attempt_id).eq("test_id", testId).maybeSingle();
  if (attemptError) return jsonError("Could not load attempt for review.", 503);
  if (!attempt) return jsonError("Attempt not found.", 404);
  const result = attempt.result && typeof attempt.result === "object" ? attempt.result as Record<string, unknown> : {};
  // The total was typed by hand for the whole work; a new dictation grade would not reach it.
  if (result.manually_reviewed_by) return jsonError("The total of this work was already set by hand.", 409);
  const rows = Array.isArray(result.per_question) ? result.per_question as Row[] : [];
  const at = rows.findIndex(row => row && row.id === body.question_id);
  const record = at >= 0 ? readDictationRecord(rows[at].dictation) : null;
  if (!record) return jsonError("Dictation not found in this work.", 404);

  const answer = (attempt.answers as Record<string, unknown> | null)?.[body.question_id];
  const { errors } = compareTexts(record.reference, typeof answer === "string" ? answer : "", record.mode);
  if (!isValidMarks(body.marks, errors.length)) return jsonError("Invalid dictation marks.");
  const graded = dictationRecord(record.reference, answer, record.mode, record.norms, body.marks);
  const nextRows = rows.map((row, i) => i === at ? { ...row, score: graded.score, dictation: graded.record } : row);
  // Another answer still waits for the teacher: the total stays open until then.
  const percentage = result.requires_manual_review === true ? null
    : percentageOf(nextRows.map(row => ({ score: typeof row.score === "number" ? row.score : 0, ...(typeof row.points === "number" ? { points: row.points } : {}) })));
  const totalScore = Math.round(nextRows.reduce((sum, row) => sum + (typeof row.score === "number" ? row.score : 0), 0) * 100) / 100;

  // Saved only if no other save reached the attempt since it was read: a hand-set
  // total or another dictation's marks would otherwise be overwritten.
  const version = typeof result.marks_version === "string" ? result.marks_version : null;
  let update = admin.from("web_attempts").update({
    percentage, result: { ...result, per_question: nextRows, total_score: totalScore, marks_version: randomUUID() },
  }).eq("id", attempt.id).eq("test_id", testId).is("result->>manually_reviewed_by", null);
  update = version ? update.eq("result->>marks_version", version) : update.is("result->>marks_version", null);
  const { data: saved, error } = await update.select("id");
  if (error) return jsonError("Could not save the dictation marks.", 503);
  if (!saved?.length) return jsonError("This work changed while you were marking it. Refresh and try again.", 409);
  return Response.json({ percentage, dictation: graded.record });
}
