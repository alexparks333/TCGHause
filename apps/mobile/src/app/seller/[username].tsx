import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ListingStrip } from '@/components/listing-strip';
import { MessageSellerButton } from '@/components/message-seller-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import {
  getActiveListings,
  getMyBids,
  getMyWatchedIds,
  getSellerReviews,
  getUserByUsername,
  unwatchListing,
  watchListing,
  type ReviewSummary,
} from '@/lib/api';
import { formatSellerTier, type Listing, type MyBid, type PublicUser } from '@/lib/types';

// The mobile counterpart to apps/web/app/seller/[username]/page.tsx —
// reachable so far only from "Sold by {username}" on the listing detail
// screen (listing/[id].tsx). Scoped to what that entry point actually
// needs: who they are (avatar/tier/member-since/bio), their rating, and
// their other active listings — not a full port of web's page (no
// review-writing form, no "message seller" button, since mobile has no
// messaging feature built at all yet).
export default function SellerProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { session } = useSession();
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [reviews, setReviews] = useState<ReviewSummary | null>(null);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [myBidsByListingId, setMyBidsByListingId] = useState<Map<string, MyBid>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUserByUsername(username)
      .then(async (user) => {
        if (!user) {
          setError('Seller not found');
          return;
        }
        setProfile(user);
        const [activeListings, reviewSummary] = await Promise.all([
          getActiveListings({ sellerId: user.id }),
          getSellerReviews(username).catch(() => null),
        ]);
        setListings(activeListings);
        setReviews(reviewSummary);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load seller'))
      .finally(() => setLoading(false));
  }, [username]);

  // Same server-fetched-initial-state pattern as the Browse tab and the
  // listing detail screen — watch state and "am I winning" are per-viewer,
  // never derivable from the seller's own public listings response.
  useEffect(() => {
    if (!session) return;
    Promise.all([getMyWatchedIds().catch(() => new Set<string>()), getMyBids().catch(() => [] as MyBid[])]).then(
      ([ids, bids]) => {
        setWatchedIds(ids);
        setMyBidsByListingId(new Map(bids.map((b) => [b.listing.id, b])));
      },
    );
  }, [session]);

  // Same fix as the Browse tab (app/(tabs)/index.tsx): the watcherCount
  // shown on each card lives on the Listing objects themselves, not in
  // watchedIds, so toggling the heart also has to patch `listings` — not
  // just flip the heart — or the count stays stale until a refetch.
  const handleToggleWatch = useCallback(
    async (listingId: string) => {
      const wasWatching = watchedIds.has(listingId);
      setWatchedIds((prev) => {
        const next = new Set(prev);
        if (wasWatching) next.delete(listingId);
        else next.add(listingId);
        return next;
      });
      setListings((prev) =>
        prev.map((l) => (l.id === listingId ? { ...l, watcherCount: l.watcherCount + (wasWatching ? -1 : 1) } : l)),
      );
      try {
        const status = wasWatching ? await unwatchListing(listingId) : await watchListing(listingId);
        setListings((prev) =>
          prev.map((l) => (l.id === listingId ? { ...l, watcherCount: status.watcherCount } : l)),
        );
      } catch {
        setWatchedIds((prev) => {
          const next = new Set(prev);
          if (wasWatching) next.add(listingId);
          else next.delete(listingId);
          return next;
        });
        setListings((prev) =>
          prev.map((l) => (l.id === listingId ? { ...l, watcherCount: l.watcherCount + (wasWatching ? 1 : -1) } : l)),
        );
      }
    },
    [watchedIds],
  );

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <ThemedText type="small">Loading…</ThemedText>
      </ThemedView>
    );
  }

  if (error || !profile) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <ThemedText type="small">{error ?? 'Seller not found'}</ThemedText>
      </ThemedView>
    );
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: profile.username ?? 'Seller', headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Avatar label={profile.username ?? 'Seller'} size={72} />
            <ThemedText type="subtitle" style={styles.username}>
              {profile.username ?? 'Seller'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatSellerTier(profile.tier)} · Member since {memberSince}
            </ThemedText>
            {reviews && reviews.count > 0 && (
              <View style={styles.ratingRow}>
                <SymbolView name="star.fill" size={14} tintColor="#E0A82E" fallback={null} />
                <ThemedText type="smallBold">{reviews.averageRating.toFixed(1)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ({reviews.count} {reviews.count === 1 ? 'review' : 'reviews'})
                </ThemedText>
              </View>
            )}
            {profile.bio && (
              <ThemedText type="small" style={styles.bio}>
                {profile.bio}
              </ThemedText>
            )}
            {session && session.user.id !== profile.id && (
              <View style={styles.messageSellerWrap}>
                <MessageSellerButton recipientId={profile.id} recipientLabel={profile.username ?? 'Seller'} />
              </View>
            )}
          </View>

          <ListingStrip
            title="Active Listings"
            listings={listings}
            watchedIds={watchedIds}
            myBidsByListingId={myBidsByListingId}
            onToggleWatch={handleToggleWatch}
          />

          {listings.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No active listings right now.
            </ThemedText>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.light.background },
  scrollContent: { paddingBottom: Spacing.six },
  header: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
  },
  username: { fontSize: 22, lineHeight: 28, marginTop: Spacing.two },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: Spacing.one },
  bio: { textAlign: 'center', marginTop: Spacing.two },
  messageSellerWrap: { marginTop: Spacing.two },
  empty: { textAlign: 'center', padding: Spacing.four },
});
