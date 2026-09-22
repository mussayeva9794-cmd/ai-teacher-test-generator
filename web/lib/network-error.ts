const SAFE_NETWORK_CODES = new Set([
  "ABORT_ERR",
  "CERT_HAS_EXPIRED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ERR_INVALID_URL",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function networkErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_error";
  if (error.name === "AbortError" || error.name === "TimeoutError") return "timeout";
  const cause = error.cause as { code?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? cause.code : "";
  return SAFE_NETWORK_CODES.has(code) ? code : "request_failed";
}
