import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { StarRating } from '@/components/account/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatSellerTier, type Listing } from '@/lib/types';

// Shared "who's selling this, and are they trustworthy" row — username,
// star rating (average + review count), and tier badge. Reused everywhere
// a listing renders on mobile (ListingCard's grid tile, ListingRow's
// horizontal row, and the listing detail screen) so the same trust signal
// apps/web already surfaces on its own ListingCard/ListingRow (CLAUDE.md
// §6.3/§6.4) shows up consistently here too — mobile had none of this
// before, just a bare username.
//
// Nested inside each surface's own outer Pressable (the whole card/row
// already navigates to the listing) — RN's touch responder system resolves
// a tap on this inner Pressable to it alone, same "nested Pressables just
// work" pattern ListingCard's watch-heart button already relies on, no
// stopPropagation equivalent needed.
export function SellerMeta({
  listing,
  compact = false,
}: {
  listing: Pick<Listing, 'sellerUsername' | 'sellerRatingAvg' | 'sellerReviewCount' | 'sellerTier'>;
  compact?: boolean;
}) {
  const router = useRouter();
  const username = listing.sellerUsername;

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <Pressable
        disabled={!username}
        hitSlop={6}
        onPress={() => username && router.push(`/seller/${username}`)}>
        <ThemedText
          numberOfLines={1}
          style={
            username
              ? compact
                ? styles.usernameCompact
                : styles.username
              : compact
                ? styles.metaCompact
                : styles.meta
          }>
          {username ?? 'Seller'}
        </ThemedText>
      </Pressable>

      <View style={styles.ratingRow}>
        <StarRating rating={listing.sellerRatingAvg} size={compact ? 10 : 13} />
        <ThemedText themeColor="textSecondary" style={compact ? styles.metaCompact : styles.meta}>
          {listing.sellerReviewCount > 0
            ? `${listing.sellerRatingAvg.toFixed(1)} (${listing.sellerReviewCount})`
            : 'No reviews yet'}
        </ThemedText>
      </View>

      <View style={[styles.tierBadge, compact && styles.tierBadgeCompact]}>
        <ThemedText style={compact ? styles.tierTextCompact : styles.tierText}>
          {formatSellerTier(listing.sellerTier)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // flexWrap, not a fixed single line — ListingCard's grid tile is narrow
  // enough that username + stars + tier badge can't reliably fit on one
  // line, so this wraps onto a second line naturally instead of clipping
  // or overflowing.
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one + 2 },
  rowCompact: { gap: Spacing.one },
  // Deliberately its own explicit size rather than ThemedText's shared
  // "small"/"default" type presets (14/16) — the username is one signal
  // among several crammed into this row, not a heading, so it needs to
  // read smaller than those presets allow in both places this renders.
  username: { fontWeight: '700', fontSize: 12, lineHeight: 15 },
  usernameCompact: { fontWeight: '700', fontSize: 10, lineHeight: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  meta: { fontSize: 12, lineHeight: 16 },
  metaCompact: { fontSize: 10, lineHeight: 13 },
  tierBadge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.backgroundElement,
  },
  tierBadgeCompact: { paddingHorizontal: 6, paddingVertical: 1 },
  tierText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  tierTextCompact: { fontSize: 9, lineHeight: 12, fontWeight: '700' },
});
