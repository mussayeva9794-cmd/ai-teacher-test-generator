import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { attemptWindowExpired } from "@/lib/attempt-window";
import { grade, isValidVariant, parseSettings, personalizedVariant } from "@/lib/assessment";
import { selectShareVariant } from "@/lib/share-variant";
import { adminClient } from "@/lib/supabase-admin";
import type { TestRow } from "@/lib/types";

export const maxDuration = 60;

// Drafts of untimed or archived tests never expire or never finalize, so a
// fixed "oldest N" window would eventually stop reaching timed drafts. Scan
// every draft in pages instead, bounded by a row cap and a time budget.
const PAGE_SIZE = 200;
const MAX_SCANNED = 5000;
const TIME_BUDGET_MS = 40_000;
const LINK_COLUMNS = "id,token,test_id,variant_name,variant_snapshot,settings";
const TEST_COLUMNS = "id,owner_id,title,topic,language,grade_level,status,variants,created_at";

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

  const began = Date.now();
  const links = new Map<string, LinkRow | null>();
  const tests = new Map<string, TestRow | null>();
  let scanned = 0;
  let expired = 0;
  let submitted = 0;
  let skipped = 0;
  let failed = 0;

  for (let offset = 0; scanned < MAX_SCANNED && Date.now() - began < TIME_BUDGET_MS;) {
    const { data: drafts, error: draftsError } = await admin.from("web_drafts")
      .select("link_id,student_id,answers,started_at,updated_at")
      .order("started_at", { ascending: true }).order("link_id", { ascending: true }).order("student_id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (draftsError) {
      console.error("Expired draft scan failed", { code: draftsError.code });
      if (scanned === 0) return Response.json({ error: "Could not scan drafts." }, { status: 503 });
      break;
    }
    const page = (drafts || []) as DraftRow[];
    scanned += page.length;

    const unknownLinkIds = [...new Set(page.map((draft) => draft.link_id))].filter((id) => !links.has(id));
    if (unknownLinkIds.length) {
      const { data: linkRows, error: linksError } = await admin.from("web_share_links").select(LINK_COLUMNS).in("id", unknownLinkIds);
      if (linksError) {
        console.error("Expired draft link lookup failed", { code: linksError.code });
        break;
      }
      for (const id of unknownLinkIds) links.set(id, null);
      for (const link of (linkRows || []) as LinkRow[]) links.set(link.id, link);
    }

    let removed = 0;
    for (const draft of page) {
      const typedLink = links.get(draft.link_id);
      if (!typedLink) { skipped += 1; continue; }
      const settings = parseSettings(typedLink.settings);
      if (!attemptWindowExpired(draft.started_at, settings.timer_minutes, settings.deadline_at)) { skipped += 1; continue; }
      expired += 1;

      if (!tests.has(typedLink.test_id)) {
        const { data: test, error: testError } = await admin.from("web_tests")
          .select(TEST_COLUMNS).eq("id", typedLink.test_id).maybeSingle();
        if (testError) { failed += 1; continue; }
        tests.set(typedLink.test_id, (test as TestRow | null) || null);
      }
      const row = tests.get(typedLink.test_id) || null;
      const variant = row ? selectShareVariant(typedLink.variant_snapshot, row.variants, typedLink.variant_name, isValidVariant) : null;
      if (!row || row.status !== "published" || !variant || !answersObject(draft.answers)) { failed += 1; continue; }

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
        const { error: deleteError } = await admin.from("web_drafts").delete()
          .eq("link_id", typedLink.id).eq("student_id", draft.student_id);
        if (!deleteError) removed += 1;
        submitted += 1;
      } else if (status === "draft_changed") {
        skipped += 1;
      } else {
        failed += 1;
      }
    }

    if (page.length < PAGE_SIZE) break;
    // Deleted drafts shift later rows forward; step back so none are skipped.
    offset += PAGE_SIZE - removed;
  }
  return Response.json({ scanned, expired, submitted, skipped, failed });
}
