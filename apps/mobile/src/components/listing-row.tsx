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
    <View style={styles.shadowWrap}>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress}>
        <View>
          <Image source={listing.imageUrls[0]} style={styles.image} contentFit="cover" transition={150} />
          {onToggleWatch && (
            <Pressable hitSlop={8} style={styles.watchButton} onPress={onToggleWatch}>
              <SymbolView
                name={watching ? 'heart.fill' : 'heart'}
                size={14}
                tintColor={watching ? '#D64545' : '#65697A'}
                fallback={null}
              />
            </Pressable>
          )}
        </View>

        <View style={styles.info}>
          <ThemedText numberOfLines={2} style={styles.title}>
            {listing.title}
          </ThemedText>
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
            <ThemedText numberOfLines={1} style={styles.winning}>
              Top bidder · up to {formatPrice(myBid!.myMaxBidCents)}
            </ThemedText>
          )}
          <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.meta}>
            {listing.freeShipping ? 'Free shipping' : `+${formatPrice(listing.shippingCostCents)} shipping`}
            {'  ·  '}
            {listing.watcherCount} watcher{listing.watcherCount === 1 ? '' : 's'}
          </ThemedText>
        </View>
      </Pressable>
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
  watchButton: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    width: 26,
    height: 26,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  info: { flex: 1, gap: 3 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  price: { fontSize: 18 },
  meta: { fontSize: 12, lineHeight: 16 },
  winning: { fontSize: 12, lineHeight: 16, color: Brand.navy, fontWeight: '600' },
});
