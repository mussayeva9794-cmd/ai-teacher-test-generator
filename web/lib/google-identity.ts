type AuthIdentity = {
  provider?: unknown;
  identity_data?: unknown;
} | null;

export function verifiedGoogleIdentityEmail(identities: readonly AuthIdentity[] | null | undefined): string | null {
  const google = identities?.find((identity) => identity?.provider === "google");
  if (!google || !google.identity_data || typeof google.identity_data !== "object") return null;

  const data = google.identity_data as Record<string, unknown>;
  if (data.email_verified !== true || typeof data.email !== "string") return null;
  const email = data.email.trim().toLowerCase();
  return email || null;
}
