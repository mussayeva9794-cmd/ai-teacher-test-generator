import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { attemptWindowExpired } from "@/lib/attempt-window";
import { grade, isValidVariant, parseSettings, personalizedVariant } from "@/lib/assessment";
import { selectShareVariant } from "@/lib/share-variant";
import { adminClient } from "@/lib/supabase-admin";
import type { TestRow } from "@/lib/types";

export const maxDuration = 60;

type DraftRow = { link_id: string; student_id: string; answers: unknown; started_at: string; updated_at: string };
type LinkRow = {
  id: string; token: string; test_id: string; variant_name: string; variant_snapshot: unknown; settings: unknown;
};

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || secret.length < 16 || provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

function answersObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && JSON.stringify(value).length <= 50_000;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return new Response("Not found.", { status: 404 });

  let admin: ReturnType<typeof adminClient>;
  try { admin = adminClient(); } catch { return Response.json({ error: "Service unavailable." }, { status: 503 }); }

  const { data: drafts, error: draftsError } = await admin.from("web_drafts")
    .select("link_id,student_id,answers,started_at,updated_at").order("updated_at", { ascending: true }).limit(100);
  if (draftsError) {
    console.error("Expired draft scan failed", { code: draftsError.code });
    return Response.json({ error: "Could not scan drafts." }, { status: 503 });
  }

  let expired = 0;
  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  for (const draft of (drafts || []) as DraftRow[]) {
    const { data: link, error: linkError } = await admin.from("web_share_links")
      .select("id,token,test_id,variant_name,variant_snapshot,settings").eq("id", draft.link_id).maybeSingle();
    if (linkError || !link) { skipped += 1; continue; }
    const typedLink = link as LinkRow;
    const settings = parseSettings(typedLink.settings);
    if (!attemptWindowExpired(draft.started_at, settings.timer_minutes, settings.deadline_at)) { skipped += 1; continue; }
    expired += 1;

    const { data: test, error: testError } = await admin.from("web_tests")
      .select("id,owner_id,title,topic,language,grade_level,status,variants,created_at").eq("id", typedLink.test_id).maybeSingle();
    const row = test as TestRow | null;
    const variant = row ? selectShareVariant(typedLink.variant_snapshot, row.variants, typedLink.variant_name, isValidVariant) : null;
    if (testError || !row || row.status !== "published" || !variant || !answersObject(draft.answers)) { failed += 1; continue; }

    const ordered = personalizedVariant(variant, typedLink.token, draft.student_id, settings.randomize);
    const allowedIds = new Set(ordered.questions.map((question) => question.id));
    const savedAnswers = Object.fromEntries(Object.entries(draft.answers).filter(([id]) => allowedIds.has(id)));
    const result = grade(ordered, savedAnswers);
    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_web_attempt", {
      p_link_id: typedLink.id,
      p_test_id: row.id,
      p_student_id: draft.student_id,
      p_expected_draft_updated_at: draft.updated_at,
      p_expected_draft_answers: draft.answers,
      p_current_answers: null,
      p_current_percentage: null,
      p_current_result: null,
      p_saved_answers: savedAnswers,
      p_saved_percentage: result.percentage,
      p_saved_result: result,
    });
    if (finalizeError) { failed += 1; continue; }
    const status = (finalized as { status?: string } | null)?.status;
    if (status === "submitted" || status === "already_submitted") {
      await admin.from("web_drafts").delete().eq("link_id", typedLink.id).eq("student_id", draft.student_id);
      submitted += 1;
    } else if (status === "draft_changed") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }
  return Response.json({ scanned: drafts?.length || 0, expired, submitted, skipped, failed });
}
