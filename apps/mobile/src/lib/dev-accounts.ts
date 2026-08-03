// Mirrors apps/web's DevQuickSwitch (CLAUDE.md §6.13) — lets switching
// between pre-seeded test accounts skip the log-out/log-in dance while
// testing bidding across identities. Not an auth bypass: it's a real
// signInWithPassword with real credentials that only exist in local .env
// files, same as the web version's reasoning.
//
// The web version hides the password behind a Next.js API route so the
// browser never sees it. There's no server layer here to hide behind, so
// this calls signInWithPassword directly — the trade-off is that these
// credentials do end up in the dev JS bundle, which is why this whole
// module is gated on __DEV__ (React Native's compiled-out-of-release-
// builds flag, the same role NODE_ENV === "development" plays on web).

export interface DevAccount {
  key: string;
  label: string;
  email: string;
  password: string;
}

function accountFor(key: string, label: string, email?: string, password?: string): DevAccount | null {
  return email && password ? { key, label, email, password } : null;
}

export const DEV_ACCOUNTS: DevAccount[] = __DEV__
  ? [
      accountFor(
        'seller',
        'Seller',
        process.env.EXPO_PUBLIC_DEV_ACCOUNT_SELLER_EMAIL,
        process.env.EXPO_PUBLIC_DEV_ACCOUNT_SELLER_PASSWORD,
      ),
      accountFor(
        'bidderA',
        'Bidder A',
        process.env.EXPO_PUBLIC_DEV_ACCOUNT_BIDDER_A_EMAIL,
        process.env.EXPO_PUBLIC_DEV_ACCOUNT_BIDDER_A_PASSWORD,
      ),
      accountFor(
        'bidderB',
        'Bidder B',
        process.env.EXPO_PUBLIC_DEV_ACCOUNT_BIDDER_B_EMAIL,
        process.env.EXPO_PUBLIC_DEV_ACCOUNT_BIDDER_B_PASSWORD,
      ),
    ].filter((a): a is DevAccount => a !== null)
  : [];
