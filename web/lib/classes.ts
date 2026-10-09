const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizedClassName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 48 ? name : null;
}

export function normalizedClassEmails(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const emails = value.map((entry) => typeof entry === "string" ? entry.trim().toLowerCase() : "");
  if (emails.some((email) => email.length > 254 || !EMAIL_PATTERN.test(email))) return null;
  return [...new Set(emails)];
}
