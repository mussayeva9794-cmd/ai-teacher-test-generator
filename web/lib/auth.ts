import type { NextRequest } from "next/server";
import { serverAuthClient, userClient } from "./supabase";

export type Actor = {
  id: string;
  email: string;
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
  return {
    id: userData.user.id,
    email: (userData.user.email || "").toLowerCase(),
    role: profile.role,
    name: profile.display_name,
    accessToken: token,
  };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
