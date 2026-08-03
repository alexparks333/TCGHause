import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/api";

// Google (and any future OAuth provider) redirects here with a `code` after
// the user approves on the provider's side. This exchanges it for a session
// and sets the session cookie — the PKCE flow's second half. See
// CLAUDE.md §6.12.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Email/password signups already have a username from SignUpForm
      // (never pass through here). Google sign-ins reach here on every
      // sign-in, first-time or not — the trigger only fills a username in
      // from Supabase user metadata, which Google's OAuth response never
      // sets, so a first-time Google account has none yet and must claim
      // one before continuing. On a Go API outage, fail open to `next`
      // rather than stranding the user on a callback that can't resolve —
      // the listing.Create gate still enforces this server-side regardless.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        try {
          const me = await getMe(session.access_token);
          if (!me.username) {
            return NextResponse.redirect(
              `${origin}/claim-username?next=${encodeURIComponent(next)}`,
            );
          }
        } catch {
          // Go API unreachable — fall through to the normal redirect.
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
