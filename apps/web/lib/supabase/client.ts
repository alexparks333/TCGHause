import { createBrowserClient } from "@supabase/ssr";

// Used from Client Components (forms, interactive buttons). Safe to call
// repeatedly — each call returns a lightweight client over the same
// browser session.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
