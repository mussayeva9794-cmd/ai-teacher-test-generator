import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { quotaErrorResponse, releaseGenerationWindow, reserveGenerationWindow } from "@/lib/generation-quota";
import { GroqGenerationError, groqErrorResponse, imagesToText } from "@/lib/groq";
import { userClient } from "@/lib/supabase";
import { adminClient } from "@/lib/supabase-admin";

export const maxDuration = 90;

const MAX_IMAGES = 3;
// Groq accepts at most 4 MB of base64 images per request; the browser shrinks photos first.
const MAX_TOTAL_CHARS = 4_000_000;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Read the text of up to three photographed pages. Nothing is stored. */
export async function POST(request: NextRequest) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  let body: { images?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const images = body && typeof body === "object" && Array.isArray(body.images) ? body.images : null;
  if (!images || !images.length || images.length > MAX_IMAGES ||
      !images.every((image): image is string => typeof image === "string" && DATA_URL.test(image)) ||
      images.reduce((sum, image) => sum + image.length, 0) > MAX_TOTAL_CHARS) {
    return jsonError("Add 1–3 photos (JPEG, PNG or WebP) of up to 4 MB in total.");
  }
  const db = userClient(actor.accessToken);
  const reservation = await reserveGenerationWindow(db);
  if (reservation.status !== "allowed") return quotaErrorResponse(reservation);
  try {
    const text = await imagesToText(images);
    if (!text) {
      await releaseGenerationWindow(adminClient, actor.id, reservation.window);
      return jsonError("No text was found in the photos. Take a sharper photo in good light.", 422);
    }
    return Response.json({ text: text.slice(0, 12000) });
  } catch (cause) {
    await releaseGenerationWindow(adminClient, actor.id, reservation.window);
    const reason = cause instanceof GroqGenerationError ? cause.reason : "upstream";
    console.error("Photo text recognition failed", { reason, upstreamStatus: cause instanceof GroqGenerationError ? cause.upstreamStatus : undefined });
    return groqErrorResponse(cause, "Photo recognition is temporarily unavailable. Paste the text or upload a PDF instead.");
  }
}
