export function GET() {
  return Response.json({
    status: "ok",
    supabase_configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY),
    groq_configured: Boolean(process.env.GROQ_API_KEY),
  }, { headers: { "Cache-Control": "no-store" } });
}
