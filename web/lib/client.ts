import { browserClient } from "./supabase";
export { oauthRequestedNext, safeNext } from "./safe-next";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await browserClient().auth.getSession();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}
