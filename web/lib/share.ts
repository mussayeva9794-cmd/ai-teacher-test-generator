import type { Actor } from "./auth";
import { adminClient } from "./supabase-admin";
import { isValidVariant, parseSettings } from "./assessment";
import { selectShareVariant } from "./share-variant";
import type { TestRow } from "./types";

export async function shareContext(token: string, actor: Actor) {
  if (actor.role !== "student") return { error: "Only student accounts can open a test.", status: 403 } as const;
  const admin = adminClient();
  const { data: link, error: linkError } = await admin.from("web_share_links")
    .select("id,test_id,variant_name,variant_snapshot,settings,is_active")
    .eq("token", token).maybeSingle();
  if (linkError || !link || !link.is_active) return { error: "This test link is unavailable.", status: 404 } as const;
  const settings = parseSettings(link.settings);
  if (settings.allowed_students.length && !settings.allowed_students.includes(actor.email)) {
    return { error: "This account is not allowed to open the test.", status: 403 } as const;
  }
  const { data: test, error: testError } = await admin.from("web_tests")
    .select("id,owner_id,title,topic,language,grade_level,status,variants,created_at")
    .eq("id", link.test_id).maybeSingle();
  if (testError || !test || test.status !== "published") {
    return { error: "This test is not published.", status: 404 } as const;
  }
  const row = test as TestRow;
  const variant = selectShareVariant(link.variant_snapshot, row.variants, link.variant_name, isValidVariant);
  if (!variant) return { error: "The test is not ready for students.", status: 503 } as const;
  return { admin, link, test: row, variant, settings } as const;
}
