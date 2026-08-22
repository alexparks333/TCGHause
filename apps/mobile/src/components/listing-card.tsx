import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { SellerMeta } from '@/components/seller-meta';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { CARD_WIDTH } from '@/constants/layout';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  formatDateTime,
  formatPrice,
  formatTimeLeft,
  hasListingEnded,
  listingSoldAt,
  type Listing,
  type MyBid,
} from '@/lib/types';

// Always sized to the shared CARD_WIDTH (constants/layout.ts) — no flex
// sizing here, so a card looks identical whether it's in the 2-column grid
// or a horizontal strip. flex:1 items inside a horizontal FlatList's
// unconstrained scroll axis can blow up in size, which is what made
// Recently Viewed cards render bigger than the grid before this.
//
// Shadow lives on the outer wrapper, rounded corners + overflow:hidden on
// the inner one — a single view can't have both, since overflow:hidden
// clips the shadow along with everything else.
export function ListingCard({
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
  // Auction-only: whether the clock (or an early Buy It Now close) has
  // actually run out — distinct from isSold below since it also gates
  // auction-specific UI (the winning-bidder tag, the Buy It Now teaser)
  // that a fixed-format listing never has in the first place.
  const hasEnded = listing.format === 'auction' && hasListingEnded(listing);
  // Same red-price-for-"not actually available" treatment as web: an ended
  // auction (won or not — "Final price" either way) or a fixed listing
  // with a real buyer. This is what makes a Sold-filtered result read as
  // "this already sold, not an active listing" at a glance.
  const isSold = hasListingEnded(listing);
  // Undefined for an auction that ended with no bids — see listingSoldAt's
  // own doc for why that must never render a sale date.
  const soldAt = listingSoldAt(listing);
  const winning = myBid?.status === 'winning' && !hasEnded;

  return (
    <View>
      <View style={styles.shadowWrap}>
        <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onPress}>
          <View>
            <Image
              source={listing.imageUrls[0]}
              style={styles.image}
              contentFit="cover"
              transition={150}
            />
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
            <ThemedText type="smallBold" style={[styles.price, isSold && styles.priceSold]}>
              {price != null ? formatPrice(price) : '—'}
            </ThemedText>
            {listing.format === 'auction' && listing.endsAt && (
              <ThemedText themeColor="textSecondary" style={styles.meta}>
                {formatTimeLeft(listing.endsAt)} · {listing.bidCount ?? 0} bids
              </ThemedText>
            )}
            {listing.format === 'auction' && soldAt && (
              <ThemedText numberOfLines={2} style={styles.soldLabel}>
                Sold {formatDateTime(soldAt)}
              </ThemedText>
            )}
            {listing.format === 'fixed' && (
              <ThemedText
                numberOfLines={isSold ? 2 : 1}
                themeColor={isSold ? undefined : 'textSecondary'}
                style={isSold ? styles.soldLabel : styles.meta}>
                {isSold ? `Sold${soldAt ? ` ${formatDateTime(soldAt)}` : ''}` : 'Buy It Now'}
              </ThemedText>
            )}
            {listing.format === 'auction' && listing.buyItNowPriceCents != null && !hasEnded && (
              <ThemedText numberOfLines={1} style={styles.buyItNow}>
                Buy It Now {formatPrice(listing.buyItNowPriceCents)}
              </ThemedText>
            )}
            <ThemedText themeColor="textSecondary" style={styles.meta}>
              {listing.freeShipping ? 'Free shipping' : `+${formatPrice(listing.shippingCostCents)} shipping`}
            </ThemedText>
            <View style={styles.divider} />
            <SellerMeta listing={listing} compact />
          </View>
        </Pressable>
      </View>
      {/* Rendered in normal flow below the card, not overlapping it at all —
          the previous "tucked behind the card, zIndex -1" version was still
          getting fully covered instead of peeking out, so this drops the
          overlap trick entirely: a small rounded pill sitting just under
          the card, guaranteed visible. */}
      {winning && (
        <View style={styles.winningTag} pointerEvents="none">
          <ThemedText numberOfLines={1} style={styles.winningTagText}>
            You&rsquo;re Top Bidder · {formatPrice(myBid!.myMaxBidCents)}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shadowWrap: {
    width: CARD_WIDTH,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  cardPressed: { opacity: 0.9 },
  image: {
    aspectRatio: 1,
    width: '100%',
    backgroundColor: Colors.light.backgroundElement,
  },
  watchArea: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
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
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  info: {
    padding: Spacing.two,
    gap: 2,
  },
  title: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '600',
    minHeight: 32,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.light.border,
    marginVertical: 3,
  },
  price: { fontSize: 14 },
  priceSold: { color: Brand.urgent },
  meta: { fontSize: 11, lineHeight: 14 },
  soldLabel: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: Colors.light.text },
  buyItNow: { fontSize: 11, lineHeight: 14, color: Brand.gold, fontWeight: '700' },
  // Deliberately outside/below the card itself, not inside its padded info
  // block or clipped into its rounded body — a tiny standalone, fully
  // rounded pill flush against the card's bottom edge, in normal flow (no
  // overlap/zIndex trick — that kept ending up fully hidden).
  winningTag: {
    alignSelf: 'center',
    marginTop: 0,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
    backgroundColor: '#2E9E5B',
  },
  winningTagText: { color: '#ffffff', fontSize: 9, lineHeight: 11, fontWeight: '700' },
});
