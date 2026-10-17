export function safeNext(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) {
    return fallback;
  }

  try {
    const target = new URL(value, "https://ai-teacher.local");
    if (target.origin !== "https://ai-teacher.local" || target.pathname.startsWith("//")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function oauthRequestedNext(value: string | null): string | null {
  const next = safeNext(value, "");
  return next || null;
}
