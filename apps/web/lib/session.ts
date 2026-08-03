import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/is-configured";

// getSession() alone reads the JWT from cookies without re-verifying it
// with the Supabase Auth server — fine for the access_token itself (every
// apps/api call still independently verifies that JWT's signature), but
// not for trusting *who* it belongs to for any display/authorization
// decision. getUser() does verify, so this always uses that for identity;
// getSession() is only used here for the access_token itself.
export async function getCurrentSession() {
  if (!isSupabaseConfigured()) {
    return { session: null, user: null };
  }
  const supabase = await createClient();
  const [sessionResult, userResult] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
  ]);
  return { session: sessionResult.data.session, user: userResult.data.user };
}
