import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Radius, Spacing } from '@/constants/theme';
import { formatSellerTier, sellerTierRate, type SellerTier } from '@/lib/types';

// A small stats strip, not a marketing section — mirrors just the two
// per-user numbers from apps/web's Hero.tsx stat row ("Your seller fee" /
// "Your Seller Tier"), dropped down to a compact single-row navy strip.
// Lives on the Account screen, right below the profile header — no margin
// of its own, since its parent ScrollView (account.tsx's `scroll` style)
// already applies consistent padding/gap to every section around it, the
// same convention Section/profileHeader follow.
// Everyone on mobile is signed in by the time they reach this screen
// (RootLayout guards the tabs behind a session), so this always shows the
// real tier, never web's logged-out "New Seller" placeholder branch.
export function Hero({ tier }: { tier: SellerTier }) {
  return (
    <View style={styles.container}>
      <View style={styles.stat}>
        <ThemedText style={styles.label}>Your Seller Tier</ThemedText>
        <ThemedText style={styles.value}>{formatSellerTier(tier)}</ThemedText>
      </View>
      <View style={styles.divider} />
      <View style={styles.stat}>
        <ThemedText style={styles.label}>Your Seller Fee</ThemedText>
        <ThemedText style={styles.value}>{sellerTierRate(tier)}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.navy,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.full,
  },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: 'rgba(255,255,255,0.2)' },
  label: { fontSize: 10.5, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  value: { fontSize: 15, fontWeight: '700', color: Brand.goldLight },
});
