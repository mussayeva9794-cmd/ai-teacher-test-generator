export function signupOptions(displayName: string, origin: string, next: string) {
  return {
    data: { display_name: displayName.trim() },
    emailRedirectTo: `${origin}/login?next=${encodeURIComponent(next)}`,
  };
}

export function defaultDestination(role: unknown): string {
  return role === "teacher" ? "/dashboard" : "/";
}
