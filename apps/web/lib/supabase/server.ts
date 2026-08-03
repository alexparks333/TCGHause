import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Used from Server Components and Route Handlers to read the current
// session. Server Components can't write cookies themselves, so setAll is
// wrapped in a try/catch — middleware.ts is what actually refreshes and
// persists the session cookie on every request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — safe to ignore.
          }
        },
      },
    },
  );
}
