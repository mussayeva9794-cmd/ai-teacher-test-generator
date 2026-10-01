import type { SupabaseClient } from "@supabase/supabase-js";

type PasskeyAuth = Pick<SupabaseClient["auth"], "registerPasskey" | "signInWithPasskey">;

export async function registerPasskey(auth: Pick<PasskeyAuth, "registerPasskey">) {
  const { data, error } = await auth.registerPasskey();
  if (error) throw error;
  if (!data) throw new Error("Passkey registration did not return a credential.");
  return data;
}

export async function signInWithPasskey(auth: Pick<PasskeyAuth, "signInWithPasskey">) {
  const { data, error } = await auth.signInWithPasskey();
  if (error) throw error;
  if (!data?.session) throw new Error("Passkey sign-in did not return a session.");
  return data.session;
}

export async function listPasskeys(auth: Pick<SupabaseClient["auth"], "passkey">) {
  const { data, error } = await auth.passkey.list();
  if (error) throw error;
  return data || [];
}

export async function deletePasskey(auth: Pick<SupabaseClient["auth"], "passkey">, passkeyId: string): Promise<void> {
  const { error } = await auth.passkey.delete({ passkeyId });
  if (error) throw error;
}
