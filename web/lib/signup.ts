export function signupOptions(displayName: string, origin: string, next: string) {
  return {
    data: { display_name: displayName.trim() },
    emailRedirectTo: `${origin}/login?next=${encodeURIComponent(next)}`,
  };
}

export function googleOAuthOptions(origin: string) {
  const redirect = new URL("/login", origin);
  return {
    provider: "google" as const,
    options: {
      redirectTo: redirect.toString(),
      scopes: "openid email profile",
      queryParams: { prompt: "select_account" },
    },
  };
}

export function defaultDestination(role: unknown): string {
  return role === "teacher" ? "/dashboard" : "/";
}
