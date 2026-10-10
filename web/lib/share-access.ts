export function isAllowedByEmailList(
  email: string,
  emailVerified: boolean,
  allowedEmails: readonly string[],
): boolean {
  if (allowedEmails.length === 0) return true;
  const normalizedEmail = email.trim().toLowerCase();
  return emailVerified && allowedEmails.some((allowed) => allowed.trim().toLowerCase() === normalizedEmail);
}
