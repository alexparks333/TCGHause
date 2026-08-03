import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

// Mirrors apps/web's GoogleSignInButton (CLAUDE.md §6.12) — same
// Supabase project, same OAuth provider config, but the redirect leg is
// necessarily different: web bounces through a real server route
// (app/auth/callback/route.ts) after Supabase's fixed callback; native has
// no server to receive that redirect, so the browser session itself hands
// the token straight back to this function instead.
//
// IMPORTANT: this requires a custom development build, not Expo Go — a
// custom URL scheme (app.json's "scheme") can't deep-link back into an app
// hosted inside Expo Go's own shared container. It'll compile and run, but
// the redirect leg will fail to return to the app when tested via Expo Go.
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const redirectTo = makeRedirectUri();
  console.log('[google-auth] redirectTo:', redirectTo);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) return { error: error.message };
  if (!data.url) return { error: 'No OAuth URL returned' };
  console.log('[google-auth] oauth url:', data.url);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.log('[google-auth] session result:', JSON.stringify(result));
  if (result.type !== 'success' || !result.url) {
    return result.type === 'cancel' ? { error: null } : { error: 'Sign-in was not completed' };
  }

  return createSessionFromUrl(result.url);
}

export async function createSessionFromUrl(url: string): Promise<{ error: string | null }> {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) return { error: errorCode };

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) return { error: null };

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  return { error: error?.message ?? null };
}
