import { SymbolView } from 'expo-symbols';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountSidebar } from '@/components/account-sidebar';
import { Avatar } from '@/components/avatar';
import { FilterSidebar, hasActiveSidebarFilters, type SidebarFilters } from '@/components/filter-sidebar';
import { GameFilterBar } from '@/components/game-filter-bar';
import { ListingCard } from '@/components/listing-card';
import { ListingRow } from '@/components/listing-row';
import { ListingStrip } from '@/components/listing-strip';
import { NotificationBell } from '@/components/notification-bell';
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
  const [sidebarFilters, setSidebarFilters] = useState<SidebarFilters>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const load = useCallback(async (game: Game | null, search: string, extra: SidebarFilters) => {
    try {
      setError(null);
      if (!game && !search && !hasActiveSidebarFilters(extra)) {
        // Default view shows only the curated strips below — no need to
        // fetch/hold the full listings set until a filter or search is
        // actually applied.
        setListings([]);
        const data = await getActiveListings({});
        // Every active auction, not just ones that already have a bid —
        // mirrors apps/web's homepage "Ending soon" section, which always
        // shows the full active set. Filtering to bidCount > 0 (the
        // original version of this) meant a fresh/lightly-used marketplace
        // showed nothing at all here, which isn't what web does. Bid-active
        // auctions still surface first via the sort.
        const auctions = data
          .filter((l) => l.format === 'auction')
          .sort((a, b) => (b.bidCount ?? 0) - (a.bidCount ?? 0))
          .slice(0, HOT_AUCTIONS_LIMIT);
        setHotAuctions(auctions);
        return;
      }
      const data = await getActiveListings({
        ...(game ? { game } : {}),
        ...(search ? { search } : {}),
        ...extra,
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
    Promise.all([
      load(activeGame, submittedQuery, sidebarFilters),
      loadRecentlyViewed(),
      loadMyState(),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGame, submittedQuery, sidebarFilters, load, loadMyState]);

  // NativeTabs keeps this screen mounted permanently — switching tabs never
  // remounts it, so the mount-only effect above only ever ran once. Without
  // this, placing a bid on the listing-detail screen and returning to
  // Browse left watchedIds/myBidsByListingId frozen at their pre-bid
  // values, so "You're the Top Bidder" (and the watch heart) could never
  // reflect a bid/watch made anywhere else in the app until a manual
  // pull-to-refresh. Re-running just loadMyState (not the listings fetch)
  // on every focus keeps it cheap while keeping this state as fresh as
  // web's server-fetched-per-navigation pattern.
  useFocusEffect(
    useCallback(() => {
      loadMyState();
    }, [loadMyState]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([
      load(activeGame, submittedQuery, sidebarFilters),
      loadRecentlyViewed(),
      loadMyState(),
    ]);
    setRefreshing(false);
  }

  // The watcherCount shown on each card lives on the Listing objects
  // themselves (listings/hotAuctions/recentlyViewed), not in watchedIds —
  // toggling the heart used to only ever flip watchedIds, so the count next
  // to it stayed stale at whatever it was on the last fetch until a manual
  // pull-to-refresh. Patches watcherCount in every array a listing might
  // currently appear in (a hot auction can also be in Recently Viewed).
  function patchWatcherCount(listingId: string, next: (count: number) => number) {
    const patch = (list: Listing[]) =>
      list.map((l) => (l.id === listingId ? { ...l, watcherCount: next(l.watcherCount) } : l));
    setListings(patch);
    setHotAuctions(patch);
    setRecentlyViewed(patch);
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
    patchWatcherCount(listingId, (c) => c + (wasWatching ? -1 : 1));
    try {
      const status = wasWatching ? await unwatchListing(listingId) : await watchListing(listingId);
      // Reconcile with the server's real count rather than trusting the
      // optimistic +/-1 forever.
      patchWatcherCount(listingId, () => status.watcherCount);
    } catch {
      setWatchedIds((prev) => {
        const next = new Set(prev);
        if (wasWatching) next.add(listingId);
        else next.delete(listingId);
        return next;
      });
      patchWatcherCount(listingId, (c) => c + (wasWatching ? 1 : -1));
    }
  }

  // Three states, not two: the curated strips (nothing filtered), a 2-col
  // grid of ListingCard (a game bubble and/or a FilterSidebar preset
  // applied — "keep it looking like the vertical badges on the homepage,"
  // not the search-results row list), and the single-column ListingRow
  // list (a text search was actually submitted). Game/sidebar filters
  // narrow the same tile grid the homepage already uses; only typing a
  // search deliberately switches the visual language to eBay-style search
  // results.
  const showStrips = !activeGame && !submittedQuery && !hasActiveSidebarFilters(sidebarFilters);
  const layoutMode: 'strips' | 'grid' | 'list' = submittedQuery ? 'list' : showStrips ? 'strips' : 'grid';

  // Deliberately ONE component tree regardless of layoutMode — this used to
  // be two different `return`s (a ScrollView-of-strips branch vs. a
  // FlatList-of-results branch), and the header (including the search
  // TextInput) lived inside both. The instant `query` went from empty to
  // non-empty, React swapped the whole subtree and remounted the
  // TextInput mid-keystroke — which is what was eating focus/dismissing
  // the keyboard after exactly one character. A single always-mounted
  // FlatList with ListHeaderComponent keeps the TextInput's position in
  // the tree stable no matter what's being shown below it. The FlatList
  // itself still remounts on a layoutMode change (via `key` below) since
  // RN doesn't allow changing numColumns on a live FlatList.
  const listHeader = (
    <View>
      <View style={styles.headerRow}>
        <Wordmark />
        <View style={styles.headerActions}>
          <NotificationBell />
          <Pressable hitSlop={12} onPress={() => setSidebarOpen(true)}>
            <Avatar
              src={session?.user.user_metadata?.avatar_url as string | undefined}
              label={(session?.user.user_metadata?.full_name as string | undefined) || session?.user.email || 'U'}
              size={34}
            />
          </Pressable>
        </View>
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
            title="Recently Viewed"
            listings={recentlyViewed}
            watchedIds={watchedIds}
            myBidsByListingId={myBidsByListingId}
            onToggleWatch={handleToggleWatch}
          />
          <ListingStrip
            title="Live Auctions"
            listings={hotAuctions}
            watchedIds={watchedIds}
            myBidsByListingId={myBidsByListingId}
            onToggleWatch={handleToggleWatch}
          />
        </>
      )}

      {layoutMode !== 'strips' && !loading && listings.length === 0 && !error && (
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
          key={layoutMode}
          style={styles.list}
          data={layoutMode === 'strips' ? [] : listings}
          keyExtractor={(item) => item.id}
          numColumns={layoutMode === 'grid' ? 2 : 1}
          columnWrapperStyle={layoutMode === 'grid' ? styles.gridRow : undefined}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) =>
            layoutMode === 'grid' ? (
              <ListingCard
                listing={item}
                onPress={() => router.push(`/listing/${item.id}`)}
                watching={watchedIds.has(item.id)}
                onToggleWatch={() => handleToggleWatch(item.id)}
                myBid={myBidsByListingId.get(item.id)}
              />
            ) : (
              <ListingRow
                listing={item}
                onPress={() => router.push(`/listing/${item.id}`)}
                watching={watchedIds.has(item.id)}
                onToggleWatch={() => handleToggleWatch(item.id)}
                myBid={myBidsByListingId.get(item.id)}
              />
            )
          }
          ItemSeparatorComponent={() => (
            <View style={{ height: layoutMode === 'grid' ? Spacing.three : Spacing.two }} />
          )}
        />
      </SafeAreaView>
      <FilterSidebar
        activeGame={activeGame}
        activeQuery={submittedQuery}
        filters={sidebarFilters}
        onApply={setSidebarFilters}
        onClearGame={() => setActiveGame(null)}
        onClearQuery={() => {
          setQuery('');
          setSubmittedQuery('');
        }}
      />
      <AccountSidebar visible={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
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
  gridRow: { gap: Spacing.three },
  error: { color: '#D64545', paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  empty: { padding: Spacing.four, textAlign: 'center' },
});
