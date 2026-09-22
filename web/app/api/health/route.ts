import { adminClient } from "@/lib/supabase";

export async function GET() {
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY);
  let supabaseAdminConnected = false;
  let supabaseAdminErrorCode: string | null = null;
  if (supabaseConfigured) {
    try {
      const { error } = await adminClient().from("web_profiles").select("id").limit(1);
      supabaseAdminConnected = !error;
      if (error) {
        supabaseAdminErrorCode = /^[a-zA-Z0-9_]{1,30}$/.test(error.code || "")
          ? error.code
          : "query_failed";
      }
    } catch {
      supabaseAdminErrorCode = "request_failed";
    }
  }
  return Response.json({
    status: "ok",
    supabase_configured: supabaseConfigured,
    supabase_admin_connected: supabaseAdminConnected,
    supabase_admin_error_code: supabaseAdminErrorCode,
    groq_configured: Boolean(process.env.GROQ_API_KEY),
  }, { headers: { "Cache-Control": "no-store" } });
}
