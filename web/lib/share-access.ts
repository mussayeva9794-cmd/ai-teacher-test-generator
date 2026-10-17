export function isAllowedByEmailList(
  email: string,
  emailVerified: boolean,
  allowedEmails: readonly string[],
): boolean {
  if (allowedEmails.length === 0) return true;
  const normalizedEmail = email.trim().toLowerCase();
  return emailVerified && allowedEmails.some((allowed) => allowed.trim().toLowerCase() === normalizedEmail);
}

export function normalizeEmailAllowlist(values: readonly string[]): string[] | null {
  if (values.length > 100) return null;
  const emails = values.map((value) => value.trim().toLowerCase());
  if (emails.some((email) => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  return [...new Set(emails)];
}

export function hasExplicitShareScope(
  classId: string | null,
  allowedEmails: readonly string[],
  allowAnyStudent: boolean,
): boolean {
  if (classId) return allowedEmails.length === 0 && !allowAnyStudent;
  if (allowAnyStudent) return allowedEmails.length === 0;
  return allowedEmails.length > 0;
}
