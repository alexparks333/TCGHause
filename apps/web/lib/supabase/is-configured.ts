// Supabase isn't configured until a project exists and its URL/publishable
// key are set (see apps/web/.env.example). Every call site that touches
// Supabase checks this first so the site still renders — just logged-out
// everywhere — instead of crashing on missing env vars.
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
