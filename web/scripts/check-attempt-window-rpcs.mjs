import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateSupabaseRootUrl(configuredUrl) {
  try {
    const parsedUrl = new URL(configuredUrl?.trim() ?? "");
    if (
      parsedUrl.protocol !== "https:" ||
      !parsedUrl.hostname.endsWith(".supabase.co") ||
      !["", "/"].includes(parsedUrl.pathname) ||
      parsedUrl.search ||
      parsedUrl.hash ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      return null;
    }
    return parsedUrl.origin;
  } catch {
    return null;
  }
}

export async function runRpcReadinessProbe({
  supabaseUrl,
  serviceKey,
  fetchImpl = fetch,
  log = console.log,
  errorLog = console.error,
}) {
  const checks = [
    {
      name: "save_web_draft_if_open",
      args: {
        p_link_id: null,
        p_test_id: null,
        p_student_id: null,
        p_answers: {},
      },
      accepts: (result) => result === "invalid",
    },
    {
      name: "finalize_web_attempt",
      args: {
        p_link_id: null,
        p_test_id: null,
        p_student_id: null,
        p_expected_draft_updated_at: null,
        p_expected_draft_answers: null,
        p_current_answers: null,
        p_current_percentage: null,
        p_current_result: null,
        p_saved_answers: null,
        p_saved_percentage: null,
        p_saved_result: null,
      },
      accepts: (result) => result?.status === "invalid",
    },
  ];

  let failed = false;

  for (const check of checks) {
    try {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${check.name}`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(check.args),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });

      if (!response.ok) {
        errorLog(`${check.name}: HTTP ${response.status}; RPC unavailable or request rejected.`);
        failed = true;
        continue;
      }

      const result = await response.json();
      if (!check.accepts(result)) {
        errorLog(`${check.name}: returned an unexpected response.`);
        failed = true;
        continue;
      }

      log(`${check.name}: ready (invalid-argument probe made no writes).`);
    } catch {
      errorLog(`${check.name}: request failed; check URL, key, and network.`);
      failed = true;
    }
  }

  return !failed;
}

async function main() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!configuredUrl || !serviceKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY privately.");
    return 1;
  }

  const supabaseUrl = validateSupabaseRootUrl(configuredUrl);
  if (!supabaseUrl) {
    console.error("NEXT_PUBLIC_SUPABASE_URL must be the HTTPS root URL of a Supabase project.");
    return 1;
  }

  const passed = await runRpcReadinessProbe({ supabaseUrl, serviceKey });
  return passed ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main();
}
