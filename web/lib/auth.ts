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
  const { data: userData, error: authError } = await serverAuthClient().auth.getUser(token);
  if (authError || !userData.user) return null;
  const { data: profile, error: profileError } = await userClient(token)
    .from("web_profiles")
    .select("role,display_name")
    .eq("id", userData.user.id)
    .single();
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

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
