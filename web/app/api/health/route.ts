export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  const supabaseConfigured = Boolean(supabaseUrl && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && supabaseSecret);
  let supabaseAdminConnected = false;
  let supabaseAdminErrorCode: string | null = null;
  let supabaseAdminStatus: number | null = null;
  if (supabaseConfigured && supabaseUrl && supabaseSecret) {
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/web_profiles?select=id&limit=1`, {
        headers: { apikey: supabaseSecret, authorization: `Bearer ${supabaseSecret}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      supabaseAdminStatus = response.status;
      supabaseAdminConnected = response.ok;
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { code?: string };
        const code = response.headers.get("sb-error-code") || payload.code || "request_failed";
        supabaseAdminErrorCode = /^[a-zA-Z0-9_-]{1,50}$/.test(code) ? code : "request_failed";
      }
    } catch {
      supabaseAdminErrorCode = "request_failed";
    }
  }

  let groqConnected = false;
  let groqStatus: number | null = null;
  if (groqKey) {
    try {
      const response = await fetch(`https://api.groq.com/openai/v1/models/${encodeURIComponent(groqModel)}`, {
        headers: { authorization: `Bearer ${groqKey}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      groqStatus = response.status;
      groqConnected = response.ok;
    } catch {
      groqStatus = null;
    }
  }
  return Response.json({
    status: "ok",
    supabase_configured: supabaseConfigured,
    supabase_admin_connected: supabaseAdminConnected,
    supabase_admin_status: supabaseAdminStatus,
    supabase_admin_error_code: supabaseAdminErrorCode,
    groq_configured: Boolean(groqKey),
    groq_connected: groqConnected,
    groq_status: groqStatus,
  }, { headers: { "Cache-Control": "no-store" } });
}
