import type { SupabaseClient } from "@supabase/supabase-js";

export async function reserveGeneration(db: Pick<SupabaseClient, "rpc">): Promise<"allowed" | "limited" | "unavailable"> {
  try {
    const { data, error } = await db.rpc("consume_web_generation_quota");
    if (error) return "unavailable";
    return data === true ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}

export async function releaseGenerationQuota(
  db: Pick<SupabaseClient, "rpc">,
  ownerId: string,
): Promise<"released" | "failed"> {
  try {
    const { error } = await db.rpc("release_web_generation_quota", { p_owner_id: ownerId });
    return error ? "failed" : "released";
  } catch {
    return "failed";
  }
}

export type GenerationReservation =
  | { status: "allowed"; window: string }
  | { status: "limited" | "unavailable" };

/** Reserve one AI generation in the teacher's hourly window (v2 RPC). */
export async function reserveGenerationWindow(db: Pick<SupabaseClient, "rpc">): Promise<GenerationReservation> {
  try {
    const { data, error } = await db.rpc("consume_web_generation_quota_v2");
    if (error || (data !== null && typeof data !== "string")) return { status: "unavailable" };
    return data === null ? { status: "limited" } : { status: "allowed", window: data };
  } catch {
    return { status: "unavailable" };
  }
}

/** Give a reserved generation back when the AI call or the save failed. */
export async function releaseGenerationWindow(admin: Pick<SupabaseClient, "rpc">, ownerId: string, window: string) {
  try {
    const { error } = await admin.rpc("release_web_generation_quota_v2", { p_owner_id: ownerId, p_window_start: window });
    if (error) console.error("Generation quota release failed", { code: error.code });
  } catch {
    console.error("Generation quota release failed", { code: "server_configuration_error" });
  }
}
