import "server-only";
import { adminClient } from "./supabase-admin";
import { studentIdentity, type StudentIdentity } from "./student-names";

const EMAIL_LOOKUPS_AT_ONCE = 10;

/**
 * Names and emails for students whose attempts or class rows the teacher can
 * already read. Callers must pass only such ids. Returns null when profiles
 * cannot be loaded; a missing email only drops the line beneath the name.
 */
export async function studentIdentities(ids: string[]): Promise<Map<string, StudentIdentity> | null> {
  const unique = [...new Set(ids)];
  const admin = adminClient();
  const names = await profileNames(unique);
  if (!names) return null;
  const emails = new Map<string, string>();
  for (let offset = 0; offset < unique.length; offset += EMAIL_LOOKUPS_AT_ONCE) {
    await Promise.all(unique.slice(offset, offset + EMAIL_LOOKUPS_AT_ONCE).map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data.user?.email) emails.set(id, data.user.email);
      } catch { /* the name alone is still shown */ }
    }));
  }
  return new Map(unique.map((id) => [id, studentIdentity(names.get(id), emails.get(id))]));
}

/** Profile names only, for the same students; null when profiles cannot be loaded. */
export async function profileNames(ids: string[]): Promise<Map<string, string> | null> {
  const unique = [...new Set(ids)];
  const admin = adminClient();
  const names = new Map<string, string>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const { data, error } = await admin.from("web_profiles")
      .select("id,display_name").in("id", unique.slice(offset, offset + 100));
    if (error) return null;
    for (const profile of data || []) names.set(profile.id, profile.display_name);
  }
  return names;
}
