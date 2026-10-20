const PRODUCTION_ORIGIN = "https://ai-teacher-test-generator.vercel.app";

export function publicTestUrl(requestOrigin: string, token: string): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  let origin: string;

  if (process.env.VERCEL_ENV === "preview") {
    const deploymentHost = process.env.VERCEL_URL?.trim();

    // A shared PUBLIC_APP_URL may point at production; keep Preview isolated.
    if (!deploymentHost || !/^[a-z0-9.-]+$/i.test(deploymentHost)) {
      throw new Error("Preview test links require a non-production app URL.");
    }
    origin = `https://${deploymentHost}`;
    if (origin === PRODUCTION_ORIGIN) {
      throw new Error("Preview test links require a non-production app URL.");
    }
  } else if (configured) {
    origin = new URL(configured).origin;
  } else {
    const local = new URL(requestOrigin);
    origin = local.hostname === "localhost" || local.hostname === "127.0.0.1"
      ? requestOrigin
      : PRODUCTION_ORIGIN;
  }

  return new URL(`/s/${encodeURIComponent(token)}`, origin).toString();
}
