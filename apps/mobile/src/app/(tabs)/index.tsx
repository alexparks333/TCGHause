import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GameFilterBar } from '@/components/game-filter-bar';
import { ListingRow } from '@/components/listing-row';
import { ListingStrip } from '@/components/listing-strip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Wordmark } from '@/components/wordmark';
import { SoftShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import {
  getActiveListings,
  getListing,
  getMyBids,
  getMyWatchedIds,
  unwatchListing,
  watchListing,
} from '@/lib/api';
import { getRecentlyViewedIds } from '@/lib/recently-viewed';
import type { Game, Listing, MyBid } from '@/lib/types';

const HOT_AUCTIONS_LIMIT = 10;

export default function BrowseScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [listings, setListings] = useState<Listing[]>([]);
  const [hotAuctions, setHotAuctions] = useState<Listing[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<Listing[]>([]);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [myBidsByListingId, setMyBidsByListingId] = useState<Map<string, MyBid>>(new Map());
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (game: Game | null, search: string) => {
    try {
      setError(null);
      if (!game && !search) {
        // Default view shows only the curated strips below — no need to
        // fetch/hold the full listings set until a filter or search is
        // actually applied.
        setListings([]);
        const data = await getActiveListings({});
        const hottest = data
          .filter((l) => l.format === 'auction' && (l.bidCount ?? 0) > 0)
          .sort((a, b) => (b.bidCount ?? 0) - (a.bidCount ?? 0))
          .slice(0, HOT_AUCTIONS_LIMIT);
        setHotAuctions(hottest);
        return;
      }
      const data = await getActiveListings({
        ...(game ? { game } : {}),
        ...(search ? { search } : {}),
      });
      setListings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load listings');
    }
  }, []);

  const loadRecentlyViewed = useCallback(async () => {
    const ids = await getRecentlyViewedIds(HOT_AUCTIONS_LIMIT);
    const results = await Promise.all(ids.map((id) => getListing(id).catch(() => null)));
    setRecentlyViewed(results.filter((l): l is Listing => l !== null));
  }, []);

  // Watch state and "am I winning" are per-account — fetched once per
  // signed-in user (not per render) and threaded down to every card,
  // exactly like apps/web's server-fetched-initial-state pattern
  // (CLAUDE.md §6.13/§6.14): never re-derive this client-side per card.
  const loadMyState = useCallback(async () => {
    if (!session) {
      setWatchedIds(new Set());
      setMyBidsByListingId(new Map());
      return;
    }
    const [ids, bids] = await Promise.all([
      getMyWatchedIds().catch(() => new Set<string>()),
      getMyBids().catch(() => [] as MyBid[]),
    ]);
    setWatchedIds(ids);
    setMyBidsByListingId(new Map(bids.map((b) => [b.listing.id, b])));
  }, [session]);

  useEffect(() => {
    setLoading(true);
    Promise.all([load(activeGame, submittedQuery), loadRecentlyViewed(), loadMyState()]).finally(
      () => setLoading(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGame, submittedQuery, load, loadMyState]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(activeGame, submittedQuery), loadRecentlyViewed(), loadMyState()]);
    setRefreshing(false);
  }

  async function handleToggleWatch(listingId: string) {
    const wasWatching = watchedIds.has(listingId);
    // Optimistic — flip immediately, roll back only if the request fails.
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (wasWatching) next.delete(listingId);
      else next.add(listingId);
      return next;
    });
    try {
      await (wasWatching ? unwatchListing(listingId) : watchListing(listingId));
    } catch {
      setWatchedIds((prev) => {
        const next = new Set(prev);
        if (wasWatching) next.add(listingId);
        else next.delete(listingId);
        return next;
      });
    }
  }

  const showStrips = !activeGame && !submittedQuery;

  // Deliberately ONE component tree regardless of showStrips — this used to
  // be two different `return`s (a ScrollView-of-strips branch vs. a
  // FlatList-of-results branch), and the header (including the search
  // TextInput) lived inside both. The instant `query` went from empty to
  // non-empty, React swapped the whole subtree and remounted the
  // TextInput mid-keystroke — which is what was eating focus/dismissing
  // the keyboard after exactly one character. A single always-mounted
  // FlatList with ListHeaderComponent keeps the TextInput's position in
  // the tree stable no matter what's being shown below it.
  const listHeader = (
    <View>
      <View style={styles.headerRow}>
        <Wordmark />
        <Pressable
          hitSlop={12}
          style={styles.cartButton}
          onPress={() => Alert.alert('Cart', 'Cart is coming soon — checkout isn’t built yet.')}>
          <SymbolView
            name="cart"
            size={19}
            tintColor={Colors.light.text}
            fallback={<ThemedText type="smallBold">Cart</ThemedText>}
          />
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <SymbolView
          name="magnifyingglass"
          size={17}
          tintColor={Colors.light.textSecondary}
          fallback={null}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search cards"
          placeholderTextColor={Colors.light.textSecondary}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => setSubmittedQuery(query)}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <GameFilterBar activeGame={activeGame} onSelect={setActiveGame} />

      {error && (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      )}

      {showStrips && (
        <>
          <ListingStrip
            title="Hot Auctions"
            listings={hotAuctions}
            watchedIds={watchedIds}
            myBidsByListingId={myBidsByListingId}
            onToggleWatch={handleToggleWatch}
          />
          <ListingStrip
            title="Recently Viewed"
            listings={recentlyViewed}
            watchedIds={watchedIds}
            myBidsByListingId={myBidsByListingId}
            onToggleWatch={handleToggleWatch}
          />
        </>
      )}

      {!showStrips && !loading && listings.length === 0 && !error && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          No active listings{activeGame ? ` in ${activeGame}` : ''} right now.
        </ThemedText>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <FlatList
          style={styles.list}
          data={showStrips ? [] : listings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) => (
            <ListingRow
              listing={item}
              onPress={() => router.push(`/listing/${item.id}`)}
              watching={watchedIds.has(item.id)}
              onToggleWatch={() => handleToggleWatch(item.id)}
              myBid={myBidsByListingId.get(item.id)}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  cartButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.surface,
    ...SoftShadow,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.surface,
    ...SoftShadow,
  },
  searchInput: { flex: 1, fontSize: 16 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six },
  error: { color: '#D64545', paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  empty: { padding: Spacing.four, textAlign: 'center' },
});
