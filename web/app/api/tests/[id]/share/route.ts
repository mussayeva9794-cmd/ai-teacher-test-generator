import type { NextRequest } from "next/server";
import { actorFromRequest, jsonError } from "@/lib/auth";
import { parseSettings } from "@/lib/assessment";
import { adminClient } from "@/lib/supabase";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const admin = adminClient();
  const { data: test } = await admin.from("web_tests").select("id,status,variants")
    .eq("id", id).eq("owner_id", actor.id).maybeSingle();
  if (!test || test.status !== "published") return jsonError("Publish this test before sharing.", 409);
  let body: { variant_name?: string; settings?: unknown };
  try { body = await request.json(); } catch { return jsonError("Invalid request body."); }
  const variantName = String(body.variant_name || "");
  if (!test.variants?.[variantName]) return jsonError("Choose an available variant.");
  const settings = parseSettings(body.settings);
  if (settings.deadline_at && !Number.isFinite(Date.parse(settings.deadline_at))) {
    return jsonError("Invalid deadline.");
  }
  const { data, error } = await admin.from("web_share_links").insert({
    test_id: id, owner_id: actor.id, variant_name: variantName, settings,
  }).select("token").single();
  if (error || !data) return jsonError("Could not create a share link.", 503);
  return Response.json({ token: data.token, url: `${request.nextUrl.origin}/s/${data.token}` });
}

export async function GET(request: NextRequest, { params }: Context) {
  const actor = await actorFromRequest(request);
  if (!actor || actor.role !== "teacher") return jsonError("Teacher sign-in required.", 401);
  const { id } = await params;
  const { data, error } = await adminClient().from("web_share_links")
    .select("id,token,variant_name,settings,is_active,created_at")
    .eq("test_id", id).eq("owner_id", actor.id).order("created_at", { ascending: false });
  if (error) return jsonError("Could not load links.", 503);
  return Response.json({ links: data || [] });
}
