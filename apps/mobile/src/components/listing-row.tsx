import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatPrice, formatTimeLeft, type Listing, type MyBid } from '@/lib/types';

// eBay-style search-result row — image left, info right, full width,
// vertically stacked list. Distinct from ListingCard (the grid/strip tile)
// rather than a variant of it, since the two need genuinely different
// layouts, not just a width change.
export function ListingRow({
  listing,
  onPress,
  watching = false,
  onToggleWatch,
  myBid,
}: {
  listing: Listing;
  onPress: () => void;
  watching?: boolean;
  onToggleWatch?: () => void;
  myBid?: MyBid;
}) {
  const price =
    listing.format === 'fixed'
      ? listing.priceCents
      : (listing.currentPriceCents ?? listing.startingBidCents);
  const hasEnded = listing.endsAt ? new Date(listing.endsAt).getTime() <= Date.now() : false;
  const winning = myBid?.status === 'winning' && !hasEnded;

  return (
    <View>
      <View style={styles.shadowWrap}>
        <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
          <View>
            <Image source={listing.imageUrls[0]} style={styles.image} contentFit="cover" transition={150} />
            {onToggleWatch && (
              <View style={styles.watchArea}>
                {listing.watcherCount > 0 && (
                  <View style={styles.watchCount}>
                    <ThemedText style={styles.watchCountText}>{listing.watcherCount}</ThemedText>
                  </View>
                )}
                <Pressable hitSlop={8} style={styles.watchButton} onPress={onToggleWatch}>
                  <SymbolView
                    name={watching ? 'heart.fill' : 'heart'}
                    size={14}
                    tintColor={watching ? '#D64545' : '#65697A'}
                    fallback={null}
                  />
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.info}>
            <ThemedText numberOfLines={2} style={styles.title}>
              {listing.title}
            </ThemedText>
            <View style={styles.divider} />
            <ThemedText type="smallBold" style={styles.price}>
              {price != null ? formatPrice(price) : '—'}
            </ThemedText>
            {listing.format === 'auction' && listing.endsAt ? (
              <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.meta}>
                {formatTimeLeft(listing.endsAt)} · {listing.bidCount ?? 0} bids
              </ThemedText>
            ) : (
              <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.meta}>
                Buy It Now
              </ThemedText>
            )}
            {winning && (
              <View style={styles.winningBadge}>
                <ThemedText numberOfLines={1} style={styles.winningBadgeText}>
                  You&rsquo;re Top Bidder · {formatPrice(myBid!.myMaxBidCents)}
                </ThemedText>
              </View>
            )}
            {listing.format === 'auction' && listing.buyItNowPriceCents != null && !hasEnded && (
              <ThemedText numberOfLines={1} style={styles.buyItNow}>
                Buy It Now {formatPrice(listing.buyItNowPriceCents)}
              </ThemedText>
            )}
            <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.meta}>
              {listing.freeShipping ? 'Free shipping' : `+${formatPrice(listing.shippingCostCents)} shipping`}
            </ThemedText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const IMAGE_SIZE = 176;

const styles = StyleSheet.create({
  shadowWrap: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  rowPressed: { opacity: 0.9 },
  image: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.backgroundElement,
  },
  watchArea: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  watchCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  watchCountText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    color: Colors.light.text,
    includeFontPadding: false,
  },
  watchButton: {
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  info: { flex: 1, gap: 3 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.light.border, marginVertical: 2 },
  price: { fontSize: 18 },
  meta: { fontSize: 12, lineHeight: 16 },
  buyItNow: { fontSize: 12, lineHeight: 16, color: Brand.gold, fontWeight: '700' },
  // Same pill as ListingCard's winningTag (bg #2E9E5B, white bold text) —
  // in the info column now, alongside price/bids/shipping, instead of a
  // separate tag attached below the row. alignSelf: 'flex-start' instead of
  // 'center' since this column is left-aligned, not centered.
  winningBadge: {
    alignSelf: 'flex-start',
    marginTop: 1,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
    backgroundColor: '#2E9E5B',
  },
  winningBadgeText: { color: '#ffffff', fontSize: 9, lineHeight: 11, fontWeight: '700' },
});
