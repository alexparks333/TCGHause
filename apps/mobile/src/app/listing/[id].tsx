import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BidBox } from '@/components/bid-box';
import { FullscreenGallery } from '@/components/fullscreen-gallery';
import { ImageGallery } from '@/components/image-gallery';
import { SellerMeta } from '@/components/seller-meta';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getListing, getMyBids, getMyWatchedIds, unwatchListing, watchListing } from '@/lib/api';
import { recordViewed } from '@/lib/recently-viewed';
import { formatPrice, type Listing, type MyBid } from '@/lib/types';

// A bit taller than a plain square, so the whole (uncropped) card photo has
// room to sit inset within it — contentFit "contain" below never crops, it
// just centers the photo in whatever box it's given, and a slightly taller
// box gives it a little breathing room above/below instead of touching the
// box edges exactly.
const PHOTO_HEIGHT = Dimensions.get('window').width * 1.15;

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [watching, setWatching] = useState(false);
  const [watcherCount, setWatcherCount] = useState(0);
  const [myBid, setMyBid] = useState<MyBid | undefined>(undefined);

  useEffect(() => {
    getListing(id)
      .then((data) => {
        if (!data) setError('Listing not found');
        setListing(data);
        if (data) {
          recordViewed(data.id);
          setWatcherCount(data.watcherCount);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load listing'))
      .finally(() => setLoading(false));
  }, [id]);

  // Same server-fetched-initial-state pattern as the Browse tab
  // (app/(tabs)/index.tsx's loadMyState) — the listing response itself has
  // no per-viewer "am I watching this" field, so that has to come from a
  // separate call once we know who's asking.
  useEffect(() => {
    if (!session || !listing) return;
    getMyWatchedIds()
      .then((ids) => setWatching(ids.has(listing.id)))
      .catch(() => {});
  }, [session, listing?.id]);

  // Same idea, for the "You're Top Bidder" badge — highBidderId is public
  // on the listing itself (CLAUDE.md §6.1: bidder identity was always
  // exposed, just never anyone's max), but the actual max amount shown in
  // the badge is private, so it has to come from /me/bids like everywhere
  // else this badge appears.
  const loadMyBid = useCallback(() => {
    if (!session || !listing) return;
    getMyBids()
      .then((bids) => setMyBid(bids.find((b) => b.listing.id === listing.id)))
      .catch(() => {});
  }, [session, listing?.id]);

  useEffect(() => {
    loadMyBid();
  }, [loadMyBid]);

  async function handleToggleWatch() {
    if (!listing) return;
    const wasWatching = watching;
    const previousCount = watcherCount;
    // Optimistic, same as ListingCard's heart — flip immediately, roll back
    // only if the request fails.
    setWatching(!wasWatching);
    setWatcherCount((c) => c + (wasWatching ? -1 : 1));
    try {
      const status = wasWatching ? await unwatchListing(listing.id) : await watchListing(listing.id);
      setWatching(status.watching);
      setWatcherCount(status.watcherCount);
    } catch {
      setWatching(wasWatching);
      setWatcherCount(previousCount);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <TopBar onPress={() => router.back()} />
        <View style={styles.center}>
          <ThemedText type="small">Loading…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error || !listing) {
    return (
      <ThemedView style={styles.container}>
        <TopBar onPress={() => router.back()} />
        <View style={styles.center}>
          <ThemedText type="small">{error ?? 'Listing not found'}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Lives in the plain background strip above the photo now, not
          floating on top of it — fixed above the ScrollView so it stays put
          (a real header, in effect) instead of scrolling away with the
          photo. */}
      <TopBar onPress={() => router.back()} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.heroWrap}>
          {/* "cover" — zoomed in to fill the box, cropping evenly off each
              edge (contentPosition="center" in ImageGallery), not letterboxed
              "contain". */}
          <ImageGallery imageUrls={listing.imageUrls} onImagePress={setFullscreenIndex} height={PHOTO_HEIGHT} />
          {/* Over the photo itself (unlike the back button, which moved off
              the photo into the plain top bar above) — same white-translucent
              treatment as the heart on every grid ListingCard, so it reads
              consistently wherever it appears in the app. */}
          {session && (
            <View style={styles.watchArea}>
              <View style={styles.watchCount}>
                <ThemedText style={styles.watchCountText}>{watcherCount} watchers</ThemedText>
              </View>
              <Pressable hitSlop={12} style={styles.watchButton} onPress={handleToggleWatch}>
                <SymbolView
                  name={watching ? 'heart.fill' : 'heart'}
                  size={16}
                  tintColor={watching ? '#D64545' : '#65697A'}
                  fallback={null}
                />
              </Pressable>
            </View>
          )}
        </View>

        <FullscreenGallery
          key={fullscreenIndex ?? 'closed'}
          visible={fullscreenIndex !== null}
          imageUrls={listing.imageUrls}
          initialIndex={fullscreenIndex ?? 0}
          onClose={() => setFullscreenIndex(null)}
        />

        <View style={styles.sheet}>
          <ThemedText type="subtitle" style={styles.title}>
            {listing.title}
          </ThemedText>

          {/* Game/Set/Card#/Condition badge row temporarily removed —
              broken, revisit later. */}

          <View style={styles.sellerMetaWrap}>
            <SellerMeta listing={listing} />
          </View>
        </View>

        {listing.format === 'auction' ? (
          <BidBox
            listing={listing}
            myBid={myBid}
            onBidPlaced={(updated) => {
              setListing({ ...listing, ...updated });
              // A new bid can flip who's winning and/or this viewer's own
              // max — re-derive both from /me/bids rather than guessing at
              // the update in place.
              loadMyBid();
            }}
          />
        ) : (
          <View style={styles.buyBox}>
            <ThemedText type="subtitle">
              {listing.priceCents != null ? formatPrice(listing.priceCents) : '—'}
            </ThemedText>
            <Pressable
              style={({ pressed }) => [styles.buyButton, pressed && styles.buyButtonPressed]}
              onPress={() => router.push(`/checkout/${listing.id}`)}>
              <ThemedText type="smallBold" style={styles.buyButtonText}>
                Buy It Now
              </ThemedText>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

// Lives in the plain background strip above the photo, not floating over
// it — so the button reads against the page background (a subtle gray
// circle, dark icon) rather than needing a dark scrim to stay legible
// against an unpredictable photo. SafeAreaView (top edge only) clears the
// status bar/notch instead of a hardcoded offset.
function TopBar({ onPress }: { onPress: () => void }) {
  return (
    <SafeAreaView edges={['top']} style={styles.topBar}>
      <Pressable hitSlop={12} style={styles.iconButton} onPress={onPress}>
        <SymbolView name="chevron.left" size={20} tintColor={Colors.light.text} fallback={null} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scrollContent: { paddingBottom: Spacing.six },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroWrap: { position: 'relative' },
  topBar: {
    backgroundColor: Colors.light.background,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundElement,
  },
  // Same white-translucent-over-photo treatment as ListingCard's own
  // watchArea/watchCount/watchButton — top-right corner of the photo, not
  // the plain top bar, so it matches the heart everywhere else it shows up.
  watchArea: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  watchCount: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 5,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  watchCountText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    color: Colors.light.text,
    includeFontPadding: false,
  },
  watchButton: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  sheet: {
    // A shallow overlap onto the photo — shallower than before (-Spacing.two,
    // not -Radius.lg), because a deeper bite was covering the page-indicator
    // dots that sit near the bottom of the photo (see image-gallery.tsx):
    // the sheet renders on top of the photo and a 20px overlap fully
    // painted over the ~12-18px band the dots live in.
    marginTop: -Spacing.two,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.light.surface,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  title: { fontSize: 20, lineHeight: 26 },
  sellerMetaWrap: { marginTop: Spacing.one },
  // Tighter gap + smaller horizontal padding than before — these are small
  // pill "bubbles" (Game/Set/Card #/Condition), not full buttons, so the
  // previous Spacing.two/Spacing.three felt like too much air between and
  // inside them.
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one - 1,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.backgroundElement,
  },
  buyBox: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  buyButton: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: Brand.gold,
  },
  buyButtonPressed: { opacity: 0.85 },
  buyButtonText: { color: '#ffffff' },
});
