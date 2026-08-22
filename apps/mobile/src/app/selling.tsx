import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListingCard } from '@/components/listing-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CARD_WIDTH } from '@/constants/layout';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getActiveListings, getMyWatchedIds, unwatchListing, watchListing } from '@/lib/api';
import type { Listing } from '@/lib/types';

// Mirrors apps/web's Selling page (app/account/selling) exactly — same two
// sections (Active / Sold), same data (getActiveListings scoped to the
// caller's own sellerId, fetched twice: once live, once with sold:true),
// same paid badge on the Sold grid. Laid out as ListingCard's own 2-column
// grid (same reasoning as watchlist.tsx) instead of a row list, since this
// is meant to look like a grid of your own listings, not a history table.
// Reachable only from the account sidebar's "Selling" link — not a
// bottom-tab screen, per explicit product decision.
//
// Every listing this grid ever receives actually sold — getActiveListings
// is called with { sold: true } below, and apps/api/internal/listing's
// Sold filter only ever returns a real sale (a fixed listing with a
// buyer_id, or an auction whose outcome is "sold"/"bought_now"). An auction
// that timed out with zero bids is just as "ended" but was never a sale,
// so it's excluded entirely rather than showing up here mislabeled — no
// "Unsold"/"No Bids" badge to render anymore.
function paymentBadge(listing: Listing): { label: string; paid: boolean } {
  return listing.paidAt ? { label: 'Paid', paid: true } : { label: 'Awaiting payment', paid: false };
}

function ListingGrid({
  listings,
  watchedIds,
  onToggleWatch,
  showOutcome,
}: {
  listings: Listing[];
  watchedIds: Set<string>;
  onToggleWatch: (listingId: string) => void;
  showOutcome?: boolean;
}) {
  const router = useRouter();
  return (
    <View style={styles.grid}>
      {listings.map((listing) => {
        const payment = showOutcome ? paymentBadge(listing) : null;
        return (
          <View key={listing.id} style={styles.gridItem}>
            {payment && (
              <View style={styles.outcomeRow}>
                <View style={[styles.outcomeBadge, styles.outcomeSold]}>
                  <ThemedText style={styles.outcomeText}>Sold</ThemedText>
                </View>
                <View style={[styles.outcomeBadge, payment.paid ? styles.outcomePaid : styles.outcomeAwaiting]}>
                  <ThemedText style={payment.paid ? styles.outcomeTextPaid : styles.outcomeTextAwaiting}>
                    {payment.label}
                  </ThemedText>
                </View>
              </View>
            )}
            <ListingCard
              listing={listing}
              onPress={() => router.push(`/listing/${listing.id}`)}
              watching={watchedIds.has(listing.id)}
              onToggleWatch={() => onToggleWatch(listing.id)}
            />
          </View>
        );
      })}
    </View>
  );
}

export default function SellingScreen() {
  const { session } = useSession();
  const [active, setActive] = useState<Listing[]>([]);
  const [sold, setSold] = useState<Listing[]>([]);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      setActive([]);
      setSold([]);
      setWatchedIds(new Set());
      return;
    }
    try {
      setError(null);
      const [mine, mineSold, ids] = await Promise.all([
        getActiveListings({ sellerId: session.user.id }),
        getActiveListings({ sellerId: session.user.id, sold: true }),
        getMyWatchedIds().catch(() => new Set<string>()),
      ]);
      setActive(mine);
      setSold(mineSold);
      setWatchedIds(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your listings');
    }
  }, [session]);

  // Keyed on the signed-in user's id, same reasoning as My Bids/Sold History.
  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load, session?.user.id]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Same watcherCount-patching fix as (tabs)/index.tsx and
  // seller/[username].tsx — a listing can appear in both the Active and
  // Sold grids' underlying arrays only in theory (they're disjoint
  // server-side), but patching both is still cheap and correct either way.
  function patchWatcherCount(listingId: string, next: (count: number) => number) {
    const patch = (list: Listing[]) =>
      list.map((l) => (l.id === listingId ? { ...l, watcherCount: next(l.watcherCount) } : l));
    setActive(patch);
    setSold(patch);
  }

  async function handleToggleWatch(listingId: string) {
    const wasWatching = watchedIds.has(listingId);
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (wasWatching) next.delete(listingId);
      else next.add(listingId);
      return next;
    });
    patchWatcherCount(listingId, (c) => c + (wasWatching ? -1 : 1));
    try {
      const status = wasWatching ? await unwatchListing(listingId) : await watchListing(listingId);
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

  const isEmpty = active.length === 0 && sold.length === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.subtitleWrap}>
          <ThemedText style={styles.subtitle}>Your active listings.</ThemedText>
        </View>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {!loading && isEmpty && !error && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              You don&rsquo;t have any active listings.
            </ThemedText>
          )}

          {!isEmpty && (
            <>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Active
              </ThemedText>
              {active.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.sectionEmpty}>
                  Nothing currently listed.
                </ThemedText>
              ) : (
                <ListingGrid listings={active} watchedIds={watchedIds} onToggleWatch={handleToggleWatch} />
              )}

              <ThemedText type="smallBold" style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
                Sold
              </ThemedText>
              {sold.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.sectionEmpty}>
                  Nothing has sold yet.
                </ThemedText>
              ) : (
                <ListingGrid
                  listings={sold}
                  watchedIds={watchedIds}
                  onToggleWatch={handleToggleWatch}
                  showOutcome
                />
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  subtitleWrap: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.one },
  subtitle: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  error: { color: '#D64545', paddingHorizontal: Spacing.three, marginTop: Spacing.two },
  empty: { padding: Spacing.four, textAlign: 'center' },
  scrollContent: { padding: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.six },
  sectionTitle: { paddingHorizontal: Spacing.one },
  sectionTitleSpaced: { marginTop: Spacing.five },
  sectionEmpty: { paddingHorizontal: Spacing.one, marginTop: Spacing.one },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.two },
  gridItem: { width: CARD_WIDTH, gap: Spacing.one },
  outcomeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  outcomeBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.full },
  outcomeSold: { backgroundColor: '#2E9E5B' },
  outcomeText: { color: '#ffffff', fontWeight: '600', fontSize: 11 },
  outcomePaid: { backgroundColor: 'rgba(46,158,91,0.1)' },
  outcomeAwaiting: { backgroundColor: 'rgba(214,69,69,0.1)' },
  outcomeTextPaid: { color: '#2E9E5B', fontWeight: '600', fontSize: 11 },
  outcomeTextAwaiting: { color: '#D64545', fontWeight: '600', fontSize: 11 },
});
