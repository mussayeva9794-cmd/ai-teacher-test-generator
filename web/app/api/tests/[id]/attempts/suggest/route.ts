import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { isValidVariant } from "@/lib/assessment";
import { answerText } from "@/lib/answer-format";
import { releaseGenerationWindow, reserveGenerationWindow } from "@/lib/generation-quota";
import { GroqGenerationError, suggestGrades, type GenerateInput, type GradeRequest } from "@/lib/groq";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";
import type { Question, TestRow, TestVariant } from "@/lib/types";

export const maxDuration = 120;

// One request grades at most this many attempts; the teacher can press again.
const MAX_ATTEMPTS = 30;
const LANGUAGES = ["russian", "kazakh", "english"] as const;

type PerQuestion = { id: string; score: number | null; requires_manual_review?: boolean };
type AttemptRow = { id: string; link_id: string; variant_name: string; answers: Record<string, unknown> | null; result: { per_question?: PerQuestion[] } | null };

/**
 * Suggest scores for attempts waiting for a teacher's check. Nothing is saved:
 * the teacher sees each suggestion and confirms the final score as before.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const db = userClient(actor.accessToken);
  const { data: testData, error: testError } = await db.from("web_tests").select("id,language,variants")
    .eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (testError) return jsonError("Could not verify test ownership.", 503);
  if (!testData) return jsonError("Test not found.", 404);
  const test = testData as Pick<TestRow, "id" | "language" | "variants">;

  const { data: attemptData, error: attemptError } = await db.from("web_attempts")
    .select("id,link_id,variant_name,answers,result").eq("test_id", id).eq("result->>requires_manual_review", "true")
    .order("submitted_at", { ascending: true }).limit(MAX_ATTEMPTS);
  if (attemptError) return jsonError("Could not load results.", 503);
  const attempts = (attemptData || []) as AttemptRow[];
  if (!attempts.length) return Response.json({ suggestions: [] });

  // Grade against the questions the students actually got: the link's snapshot.
  const linkIds = [...new Set(attempts.map((attempt) => attempt.link_id))];
  const { data: links, error: linkError } = await db.from("web_share_links").select("id,variant_snapshot")
    .eq("test_id", id).eq("owner_id", actor.id).in("id", linkIds);
  if (linkError) return jsonError("Could not load links.", 503);
  const snapshots = new Map((links || []).map((link) => [link.id as string, link.variant_snapshot as unknown]));
  const variantOf = (attempt: AttemptRow): TestVariant | null => {
    const snapshot = snapshots.get(attempt.link_id);
    if (isValidVariant(snapshot)) return snapshot;
    const current = test.variants && Object.hasOwn(test.variants, attempt.variant_name) ? test.variants[attempt.variant_name] : null;
    return isValidVariant(current) ? current : null;
  };

  const items: GradeRequest[] = [];
  for (const attempt of attempts) {
    const variant = variantOf(attempt);
    if (!variant) continue;
    for (const row of attempt.result?.per_question || []) {
      if (!row?.requires_manual_review) continue;
      const question = variant.questions.find((item: Question) => item.id === row.id);
      if (!question) continue;
      items.push({
        key: `${attempt.id}:${row.id}`, question: question.question,
        modelAnswer: question.correct_answer, studentAnswer: answerText(question, attempt.answers?.[row.id]),
      });
    }
  }
  if (!items.length) return Response.json({ suggestions: [] });

  const reservation = await reserveGenerationWindow(db);
  if (reservation.status !== "allowed") {
    return reservation.status === "limited"
      ? jsonError("Generation limit reached: 5 requests per hour. Try later.", 429)
      : jsonError("Generation is temporarily unavailable. Check the database migration.", 503);
  }
  const language = (LANGUAGES as readonly string[]).includes(test.language) ? test.language as GenerateInput["language"] : "russian";
  let grades;
  try {
    grades = await suggestGrades(items.slice(0, 80), language);
  } catch (cause) {
    await releaseGenerationWindow(adminClient, actor.id, reservation.window);
    const reason = cause instanceof GroqGenerationError ? cause.reason : "upstream";
    console.error("Grade suggestion failed", { reason });
    if (reason === "rate_limit") return jsonError("Groq request limit was reached. Wait one minute and retry.", 429);
    if (reason === "timeout") return jsonError("Groq took too long to answer. Retry the generation.", 503);
    return jsonError("Groq is temporarily unavailable. Retry shortly.", 503);
  }
  const byKey = new Map(grades.map((grade) => [grade.key, grade]));

  const suggestions = attempts.flatMap((attempt) => {
    const rows = attempt.result?.per_question || [];
    if (!rows.length) return [];
    const questions: { id: string; score: number; comment: string }[] = [];
    let total = 0;
    for (const row of rows) {
      if (row?.requires_manual_review) {
        const grade = byKey.get(`${attempt.id}:${row.id}`);
        // Without a suggestion for every open answer there is no total to suggest.
        if (!grade) return [];
        questions.push({ id: row.id, score: grade.score, comment: grade.comment });
        total += grade.score;
      } else total += typeof row?.score === "number" ? row.score : 0;
    }
    return [{ attempt_id: attempt.id, questions, percentage: Math.round(total / rows.length * 10000) / 100 }];
  });
  return Response.json({ suggestions });
}
