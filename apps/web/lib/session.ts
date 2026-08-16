import { cache } from "react";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/is-configured";

// getSession() alone reads the JWT from cookies without re-verifying it
// with the Supabase Auth server — fine for the access_token itself (every
// apps/api call still independently verifies that JWT's signature), but
// not for trusting *who* it belongs to for any display/authorization
// decision. getUser() does verify, so this always uses that for identity;
// getSession() is only used here for the access_token itself.
//
// Wrapped in React's cache() because almost every page calls this once
// directly *and* renders <Header /> (or sits inside app/account/layout.tsx,
// which renders it), which calls it again independently — without this,
// that was two real network round trips to Supabase's Auth server
// (getUser() actually re-verifies the JWT remotely, it's not a local
// cookie read) for the exact same request, stacking on top of proxy.ts's
// own middleware-level session refresh. cache() memoizes by call
// arguments for the lifetime of a single request, so both call sites
// share one getUser() round trip instead of paying for it twice.
export const getCurrentSession = cache(async () => {
  if (!isSupabaseConfigured()) {
    return { session: null, user: null };
  }
  const supabase = await createClient();
  const [sessionResult, userResult] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
  ]);
  return { session: sessionResult.data.session, user: userResult.data.user };
});

export interface LocalSession {
  accessToken: string;
  // Decoded from the session cookie locally, NOT re-verified with
  // Supabase's Auth server — never use this for an authorization decision
  // (e.g. "does this id match the listing's seller"). It's only safe for
  // "which rows are mine" query filters on a route that's already gated by
  // a real getCurrentSession()/getUser() check upstream (every
  // app/account/* page, via app/account/layout.tsx's redirect), where a
  // forged id could at worst make the query return nothing, not leak or
  // authorize anything.
  userId: string;
}

// Fast path for pages that need the access_token (and sometimes the
// unverified user id) to call apps/api, but don't need verified identity
// for a display/authorization decision — a local cookie decode, no
// network round trip, unlike getCurrentSession()'s getUser() call. Safe
// specifically because every apps/api endpoint independently re-verifies
// the JWT's signature itself (see the comment above getCurrentSession).
//
// The actual point of this existing separately from getCurrentSession():
// a page that does `const { session } = await getCurrentSession(); ...
// then fetches data with session.access_token` was forcing those data
// fetches to wait behind the slow getUser() network call even though they
// never needed the verified user at all. Call this one to kick off
// token-authenticated fetches immediately, in the same Promise.all as
// getCurrentSession() (for whatever identity check the page also needs),
// instead of sequentially after it.
export const getLocalSession = cache(async (): Promise<LocalSession | null> => {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { accessToken: session.access_token, userId: session.user.id };
});
