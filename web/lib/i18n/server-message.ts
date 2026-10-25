import type { Dictionary } from "./dictionaries";

/**
 * Server and Supabase errors stay in English for the API and logs; people
 * read them in their interface language. Unknown text falls back to a
 * generic message rather than showing raw English.
 */
export function serverMessage(t: Dictionary, message: string | null | undefined, fallback?: string): string {
  const text = String(message || "").trim();
  if (t.serverErrors[text]) return t.serverErrors[text];
  if (/^Request failed \(\d+\)$/.test(text) || /^(Failed to fetch|Load failed|NetworkError|TypeError: Failed to fetch)/i.test(text)) {
    return t.common.offline;
  }
  if (/rate limit|too many requests|only request this after/i.test(text)) return t.serverRateLimited;
  if (!text) return fallback || t.common.genericError;
  // Text without Latin letters is already human-readable in some language.
  if (!/[A-Za-z]/.test(text)) return text;
  return fallback || t.common.genericError;
}
