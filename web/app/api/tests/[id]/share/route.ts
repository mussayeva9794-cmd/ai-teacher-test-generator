import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { isValidVariant, parseSettings } from "@/lib/assessment";
import { publicTestUrl } from "@/lib/public-url";
import { isMissingClassSchema } from "@/lib/schema-compat";
import { userClient } from "@/lib/supabase";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const db = userClient(actor.accessToken);
  const { data: test } = await db.from("web_tests").select("id,status,variants")
    .eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (!test || test.status !== "published") return jsonError("Publish this test before sharing.", 409);
  let body: { variant_name?: string; settings?: unknown; class_id?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const variantName = String(body.variant_name || "");
  const variantSnapshot = test.variants?.[variantName];
  if (!isValidVariant(variantSnapshot)) return jsonError("Choose an available variant.");
  const settings = parseSettings(body.settings);
  if (body.class_id !== undefined && body.class_id !== null && typeof body.class_id !== "string") {
    return jsonError("Invalid class selection.");
  }
  const classId = typeof body.class_id === "string" && body.class_id.trim() ? body.class_id.trim() : null;
  if (classId) {
    const { data: classRow, error: classError } = await db.from("web_classes")
      .select("id").eq("id", classId).eq("owner_id", actor.id).eq("is_active", true).maybeSingle();
    if (classError || !classRow) return jsonError("Choose one of your active classes.", 400);
  }
  if (settings.deadline_at && !Number.isFinite(Date.parse(settings.deadline_at))) {
    return jsonError("Invalid deadline.");
  }
  const { data, error } = await db.from("web_share_links").insert({
    test_id: id, owner_id: actor.id, ...(classId ? { class_id: classId } : {}), variant_name: variantName,
    variant_snapshot: variantSnapshot,
    settings: classId ? { ...settings, allowed_students: [] } : settings,
  }).select("token").single();
  if (error || !data) return jsonError("Could not create a share link.", 503);
  return Response.json({ token: data.token, url: publicTestUrl(request.nextUrl.origin, data.token) });
}

export async function GET(request: NextRequest, { params }: Context) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const db = userClient(actor.accessToken);
  let { data, error } = await db.from("web_share_links")
    .select("id,token,variant_name,settings,is_active,created_at,class_id")
    .eq("test_id", id).eq("owner_id", actor.id).order("created_at", { ascending: false });
  if (isMissingClassSchema(error)) {
    const legacy = await db.from("web_share_links")
      .select("id,token,variant_name,settings,is_active,created_at")
      .eq("test_id", id).eq("owner_id", actor.id).order("created_at", { ascending: false });
    data = legacy.data ? legacy.data.map((link) => ({ ...link, class_id: null })) : null;
    error = legacy.error;
  }
  if (error) return jsonError("Could not load links.", 503);
  return Response.json({ links: (data || []).map((link) => ({
    ...link,
    url: publicTestUrl(request.nextUrl.origin, link.token),
  })) });
}
