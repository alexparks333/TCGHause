import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { CARD_WIDTH } from '@/constants/layout';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatPrice, formatTimeLeft, type Listing, type MyBid } from '@/lib/types';

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
  const hasEnded = listing.endsAt ? new Date(listing.endsAt).getTime() <= Date.now() : false;
  const winning = myBid?.status === 'winning' && !hasEnded;

  return (
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
          {listing.format === 'auction' && listing.endsAt && (
            <ThemedText themeColor="textSecondary" style={styles.meta}>
              {formatTimeLeft(listing.endsAt)} · {listing.bidCount ?? 0} bids
            </ThemedText>
          )}
          {listing.format === 'fixed' && (
            <ThemedText themeColor="textSecondary" style={styles.meta}>
              Buy It Now
            </ThemedText>
          )}
          {winning && (
            <ThemedText numberOfLines={1} style={styles.winning}>
              Top bidder · up to {formatPrice(myBid!.myMaxBidCents)}
            </ThemedText>
          )}
          <ThemedText themeColor="textSecondary" style={styles.meta}>
            {listing.freeShipping ? 'Free shipping' : `+${formatPrice(listing.shippingCostCents)} shipping`}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.meta}>
            {listing.watcherCount} watcher{listing.watcherCount === 1 ? '' : 's'}
          </ThemedText>
        </View>
      </Pressable>
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
  watchButton: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
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
  price: { fontSize: 14 },
  meta: { fontSize: 11, lineHeight: 14 },
  winning: { fontSize: 11, lineHeight: 14, color: Brand.navy, fontWeight: '600' },
});
