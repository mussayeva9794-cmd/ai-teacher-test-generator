import type { NextRequest } from "next/server";
import { serverAuthClient, userClient } from "./supabase";
import { verifiedGoogleIdentityEmail } from "./google-identity";

export type Actor = {
  id: string;
  email: string;
  emailVerified: boolean;
  hasGoogleIdentity: boolean;
  googleEmail: string | null;
  role: "teacher" | "student";
  name: string;
  accessToken: string;
};

export async function actorFromRequest(request: NextRequest): Promise<Actor | null> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const subject = tokenSubject(token);
  if (!subject) return null;
  // The profile read runs under the caller's own token and RLS, so it can start
  // before getUser finishes; the identity still comes only from getUser.
  const [{ data: userData, error: authError }, { data: profile, error: profileError }] = await Promise.all([
    serverAuthClient().auth.getUser(token),
    userClient(token).from("web_profiles").select("role,display_name").eq("id", subject).maybeSingle(),
  ]);
  if (authError || !userData.user || userData.user.id !== subject) return null;
  if (profileError || !profile || !["teacher", "student"].includes(profile.role)) return null;
  const email = (userData.user.email || "").trim().toLowerCase();
  const googleEmail = verifiedGoogleIdentityEmail(userData.user.identities);
  return {
    id: userData.user.id,
    email,
    emailVerified: Boolean(userData.user.email_confirmed_at || googleEmail === email),
    hasGoogleIdentity: Boolean(
      userData.user.app_metadata?.providers?.includes("google") ||
      userData.user.identities?.some((identity) => identity.provider === "google"),
    ),
    googleEmail,
    role: profile.role,
    name: profile.display_name,
    accessToken: token,
  };
}

/** The unverified `sub` claim, used only to start the RLS-scoped profile read early. */
function tokenSubject(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"));
    return typeof payload.sub === "string" && /^[0-9a-f-]{36}$/i.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
