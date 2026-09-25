const PRODUCTION_ORIGIN = "https://ai-teacher-test-generator.vercel.app";

export function publicTestUrl(requestOrigin: string, token: string): string {
  const local = new URL(requestOrigin);
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const origin = configured || (
    local.hostname === "localhost" || local.hostname === "127.0.0.1"
      ? requestOrigin
      : PRODUCTION_ORIGIN
  );
  return new URL(`/s/${encodeURIComponent(token)}`, origin).toString();
}
