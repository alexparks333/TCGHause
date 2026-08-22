import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Appearance } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useSession } from '@/lib/auth-context';

SplashScreen.preventAutoHideAsync();

// The brand (navy/gold/white surfaces, Colors.light in constants/theme.ts)
// is designed as a light theme only — there's no real dark palette behind
// Colors.dark, it's just a rough guess nobody has actually styled against.
// useColorScheme() (hooks/use-color-scheme.ts) mirrors the OS setting live,
// so a phone in Dark Mode was rendering near-black backgrounds under text/
// pills that were only ever designed to sit on white — illegible, not a
// deliberate dark mode. Forcing 'light' here overrides what useColorScheme()
// reports app-wide, independent of the phone's actual system setting.
Appearance.setColorScheme('light');

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, loading } = useSession();

  // Keep the native splash screen up until we know whether there's a
  // session — avoids a flash of the sign-in screen for an already-signed-in
  // user while AsyncStorage's stored session is still being read.
  if (loading) return null;
  SplashScreen.hideAsync();

  return (
    // headerBackTitle here is the default for every screen's back button in
    // this stack — without it, native-stack falls back to the PREVIOUS
    // screen's own title, and "(tabs)" has none set, so every screen pushed
    // straight from a tab (withdraw, sold-history, selling, seller/
    // [username], checkout) showed a literal "(tabs)" as its back label.
    <Stack screenOptions={{ headerShown: false, headerBackTitle: 'Back' }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        {/* No native header here — the screen renders its own floating back
            button over the listing photo instead (see listing/[id].tsx), so
            a full-width white header bar doesn't eat into the image. */}
        <Stack.Screen name="listing/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="withdraw" options={{ headerShown: true, title: 'Withdraw' }} />
        <Stack.Screen name="sold-history" options={{ headerShown: true, title: 'Sold History' }} />
        <Stack.Screen name="buy-history" options={{ headerShown: true, title: 'Buy History' }} />
        <Stack.Screen name="selling" options={{ headerShown: true, title: 'Selling' }} />
        <Stack.Screen name="transactions" options={{ headerShown: true, title: 'Transactions' }} />
        {/* title set dynamically once the order's listing has loaded — see
            app/order/[id].tsx, same pattern as seller/[username]. */}
        <Stack.Screen name="order/[id]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="checkout/[id]" options={{ headerShown: true, title: 'Checkout' }} />
        {/* title/headerBackTitle set dynamically from within the screen
            itself (its own <Stack.Screen options={...}/>) once the seller's
            username has loaded — see app/seller/[username].tsx. */}
        <Stack.Screen name="seller/[username]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="messages/index" options={{ headerShown: true, title: 'Messages' }} />
        {/* title set dynamically once the conversation's counterpart has
            loaded — see app/messages/[id].tsx, same pattern as
            seller/[username]. */}
        <Stack.Screen name="messages/[id]" options={{ headerShown: true, title: '' }} />
        {/* title set from the recipientLabel query param passed in by
            MessageSellerButton — see app/messages/new.tsx. This static
            route resolves ahead of messages/[id] for the literal path
            /messages/new. */}
        <Stack.Screen name="messages/new" options={{ headerShown: true, title: '' }} />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
