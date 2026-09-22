import { adminClient } from "@/lib/supabase";

export async function GET() {
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY);
  let supabaseAdminConnected = false;
  if (supabaseConfigured) {
    try {
      const { error } = await adminClient().from("web_profiles").select("id").limit(1);
      supabaseAdminConnected = !error;
    } catch {
      supabaseAdminConnected = false;
    }
  }
  return Response.json({
    status: "ok",
    supabase_configured: supabaseConfigured,
    supabase_admin_connected: supabaseAdminConnected,
    groq_configured: Boolean(process.env.GROQ_API_KEY),
  }, { headers: { "Cache-Control": "no-store" } });
}
