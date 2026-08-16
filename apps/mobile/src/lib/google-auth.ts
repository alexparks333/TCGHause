import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';

import { supabase } from './supabase';

// Mirrors apps/web's GoogleSignInButton (CLAUDE.md §6.12) in outcome (a
// Supabase session), but the mechanism is deliberately different from web's
// browser-redirect OAuth flow. The original mobile implementation used
// expo-web-browser's openAuthSessionAsync, which opens iOS's
// ASWebAuthenticationSession — that's what threw the system-level "'Mobile'
// wants to use '<project-ref>.supabase.co' to sign in" consent dialog, since
// ASWebAuthenticationSession is required by Apple to disclose exactly which
// domain's browser session an app is about to share. Swapping to Google's
// native SDK (GoogleSignin.signIn()) skips that browser session entirely
// when the Google app is installed, or falls back to an in-app flow that
// discloses the trusted "accounts.google.com" domain, not an opaque Supabase
// project ref — both read as legitimate, unlike the old prompt. The ID token
// it returns goes straight to Supabase's signInWithIdToken, so no redirect
// leg, no custom URL scheme, no deep-link handling required at all.
//
// Requires a native rebuild (`npx expo prebuild --clean` + `npx expo run:ios`)
// — this is native-module code, it will not run inside Expo Go or an old
// dev-client build made before this package was added.
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { error: null };

    const idToken = response.data.idToken;
    if (!idToken) return { error: 'Google did not return an ID token' };

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    return { error: error?.message ?? null };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return { error: null };
    return { error: err instanceof Error ? err.message : 'Google sign-in failed' };
  }
}
