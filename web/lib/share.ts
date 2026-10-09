import type { Actor } from "./auth";
import { adminClient } from "./supabase-admin";
import { isValidVariant, parseSettings } from "./assessment";
import { selectShareVariant } from "./share-variant";
import { isMissingClassSchema } from "./schema-compat";
import type { TestRow } from "./types";

export async function shareContext(token: string, actor: Actor) {
  if (actor.role !== "student") return { error: "Only student accounts can open a test.", status: 403 } as const;
  const admin = adminClient();
  let { data: link, error: linkError } = await admin.from("web_share_links")
    .select("id,test_id,owner_id,class_id,variant_name,variant_snapshot,settings,is_active")
    .eq("token", token).maybeSingle();
  if (isMissingClassSchema(linkError)) {
    const legacy = await admin.from("web_share_links")
      .select("id,test_id,owner_id,variant_name,variant_snapshot,settings,is_active")
      .eq("token", token).maybeSingle();
    link = legacy.data ? { ...legacy.data, class_id: null } : null;
    linkError = legacy.error;
  }
  if (linkError || !link || !link.is_active) return { error: "This test link is unavailable.", status: 404 } as const;
  const settings = parseSettings(link.settings);
  if (link.class_id) {
    if (!actor.hasGoogleIdentity || !actor.googleEmail) {
      return { error: "Sign in with the verified Google account enrolled in this class.", status: 403 } as const;
    }
    const { data: classRow, error: classError } = await admin.from("web_classes")
      .select("id,owner_id,is_active").eq("id", link.class_id).maybeSingle();
    if (classError) return { error: "Could not verify class access.", status: 503 } as const;
    if (!classRow || !classRow.is_active || classRow.owner_id !== link.owner_id) {
      return { error: "This class test link is unavailable.", status: 404 } as const;
    }

    const { data: byStudentId, error: studentLookupError } = await admin.from("web_class_members")
      .select("id,email,student_id").eq("class_id", link.class_id).eq("student_id", actor.id).maybeSingle();
    if (studentLookupError) return { error: "Could not verify class access.", status: 503 } as const;
    if (byStudentId && byStudentId.email !== actor.googleEmail) {
      return { error: "This Google account does not match the class roster.", status: 403 } as const;
    }
    if (!byStudentId) {
      const { data: invite, error: inviteError } = await admin.from("web_class_members")
        .select("id,student_id").eq("class_id", link.class_id).eq("email", actor.googleEmail).maybeSingle();
      if (inviteError) return { error: "Could not verify class access.", status: 503 } as const;
      if (!invite || invite.student_id) {
        return { error: "This account is not enrolled in the selected class.", status: 403 } as const;
      }
      const { data: claimed, error: claimError } = await admin.from("web_class_members")
        .update({ student_id: actor.id }).eq("id", invite.id).is("student_id", null)
        .select("student_id").maybeSingle();
      if (claimError) return { error: "Could not verify class access.", status: 503 } as const;
      if (claimed?.student_id !== actor.id) {
        const { data: existing, error: existingError } = await admin.from("web_class_members")
          .select("id").eq("class_id", link.class_id).eq("student_id", actor.id).maybeSingle();
        if (existingError) return { error: "Could not verify class access.", status: 503 } as const;
        if (!existing) return { error: "This account is not enrolled in the selected class.", status: 403 } as const;
      }
    }
  } else if (settings.allowed_students.length && !settings.allowed_students.includes(actor.email)) {
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
