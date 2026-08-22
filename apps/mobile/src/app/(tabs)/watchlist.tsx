import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingCard } from '@/components/listing-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getListing, getMyBids, getMyWatchedIds, unwatchListing } from '@/lib/api';
import { hasListingEnded, type Listing, type MyBid } from '@/lib/types';

// The mobile counterpart to apps/web/app/account/watchlist/page.tsx — same
// data (getMyWatchedIds -> getListing per id, no dedicated "my watched
// listings" endpoint exists), same copy, same "unwatching here removes the
// card" behavior. Laid out as ListingCard's own 2-column grid (CARD_WIDTH
// in constants/layout.ts was already sized for this, not just the home
// strips) rather than a row list, to actually look like web's grid.
export default function WatchlistScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [listings, setListings] = useState<Listing[]>([]);
  const [myBidsByListingId, setMyBidsByListingId] = useState<Map<string, MyBid>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      setListings([]);
      setMyBidsByListingId(new Map());
      return;
    }
    try {
      setError(null);
      const [ids, bids] = await Promise.all([
        getMyWatchedIds(),
        getMyBids().catch(() => [] as MyBid[]),
      ]);
      const results = await Promise.all(Array.from(ids).map((id) => getListing(id).catch(() => null)));
      // Watching something that later sells or ends doesn't keep it here —
      // the only place to still find it is a Sold-filtered search, same
      // rule as Recently Viewed/Live Auctions/an unfiltered browse.
      setListings(results.filter((l): l is Listing => l !== null && !hasListingEnded(l)));
      setMyBidsByListingId(new Map(bids.map((b) => [b.listing.id, b])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your watchlist');
    }
  }, [session]);

  // Keyed on the signed-in user's id, same reasoning as My Bids — otherwise
  // switching accounts leaves this screen showing the previous account's
  // watchlist.
  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load, session?.user.id]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // This list IS the watchlist, so unwatching removes the card outright —
  // unlike the heart everywhere else in the app, there's no "outline" state
  // to flip back to here. Optimistic; a failed unwatch just reloads the
  // real list rather than trying to re-insert the card back into position.
  async function handleToggleWatch(listingId: string) {
    setListings((prev) => prev.filter((l) => l.id !== listingId));
    try {
      await unwatchListing(listingId);
    } catch {
      load();
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <ThemedText type="title" style={styles.header}>
          Watchlist
        </ThemedText>
        <View style={styles.subtitleWrap}>
          <ThemedText style={styles.subtitle}>Listings you&rsquo;re keeping an eye on.</ThemedText>
        </View>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}
        {!loading && listings.length === 0 && !error && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            You&rsquo;re not watching anything yet. Tap the heart on a listing to save it here.
          </ThemedText>
        )}

        <FlatList
          data={listings}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={() => router.push(`/listing/${item.id}`)}
              watching
              onToggleWatch={() => handleToggleWatch(item.id)}
              myBid={myBidsByListingId.get(item.id)}
            />
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { fontSize: 28, lineHeight: 34, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  subtitleWrap: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
  subtitle: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  list: { padding: Spacing.three, paddingTop: 0, paddingBottom: Spacing.six },
  row: { gap: Spacing.three },
  error: { color: '#D64545', paddingHorizontal: Spacing.three },
  empty: { padding: Spacing.four, textAlign: 'center' },
});
