import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase-admin";
import { studentIdentity, type StudentIdentity } from "./student-names";

const EMAIL_LOOKUPS_AT_ONCE = 10;
// Up to this many students each email is looked up by id; above it the user
// list is read in pages, so a 20,000-row export costs a bounded number of calls.
const SINGLE_LOOKUP_LIMIT = 50;
const USERS_PER_PAGE = 1000;
const MAX_USER_PAGES = 100;

/**
 * Names and emails for students whose attempts or class rows the teacher can
 * already read. Callers must pass only such ids. Returns null when profiles or
 * emails cannot be loaded, so a teacher never gets a silently incomplete list.
 */
export async function studentIdentities(ids: string[]): Promise<Map<string, StudentIdentity> | null> {
  const unique = [...new Set(ids)];
  const names = await profileNames(unique);
  if (!names) return null;
  const emails = await studentEmails(adminClient(), unique);
  if (!emails) return null;
  return new Map(unique.map((id) => [id, studentIdentity(names.get(id), emails.get(id))]));
}

async function studentEmails(admin: SupabaseClient, ids: string[]): Promise<Map<string, string> | null> {
  const emails = new Map<string, string>();
  try {
    if (ids.length <= SINGLE_LOOKUP_LIMIT) {
      for (let offset = 0; offset < ids.length; offset += EMAIL_LOOKUPS_AT_ONCE) {
        const results = await Promise.all(ids.slice(offset, offset + EMAIL_LOOKUPS_AT_ONCE).map((id) => admin.auth.admin.getUserById(id)));
        for (const { data, error } of results) {
          // A deleted account has no email to show; any other error is a failure.
          if (error && error.status !== 404) throw error;
          if (data.user?.email) emails.set(data.user.id, data.user.email);
        }
      }
      return emails;
    }
    const wanted = new Set(ids);
    const found = new Set<string>();
    for (let page = 1; found.size < wanted.size; page++) {
      // More users than the scan covers: report it rather than return a partial list.
      if (page > MAX_USER_PAGES) throw new Error("User list is larger than the lookup covers.");
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
      if (error) throw error;
      for (const user of data.users) {
        if (!wanted.has(user.id)) continue;
        found.add(user.id);
        if (user.email) emails.set(user.id, user.email);
      }
      if (data.users.length < USERS_PER_PAGE) break;
    }
    return emails;
  } catch (error) {
    console.error("Student email lookup failed", { status: (error as { status?: number }).status });
    return null;
  }
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
