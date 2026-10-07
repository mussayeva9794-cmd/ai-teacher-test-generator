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
