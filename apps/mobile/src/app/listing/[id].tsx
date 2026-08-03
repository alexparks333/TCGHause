import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BidBox } from '@/components/bid-box';
import { FullscreenGallery } from '@/components/fullscreen-gallery';
import { ImageGallery } from '@/components/image-gallery';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { getListing } from '@/lib/api';
import { recordViewed } from '@/lib/recently-viewed';
import { formatPrice, type Listing } from '@/lib/types';

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);

  useEffect(() => {
    getListing(id)
      .then((data) => {
        if (!data) setError('Listing not found');
        setListing(data);
        if (data) recordViewed(data.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load listing'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="small">Loading…</ThemedText>
      </ThemedView>
    );
  }

  if (error || !listing) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="small">{error ?? 'Listing not found'}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <ImageGallery imageUrls={listing.imageUrls} onImagePress={setFullscreenIndex} />

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

        <View style={styles.badgeRow}>
          <Badge label={listing.game} />
          <Badge label={listing.set} />
          {listing.cardNumber && <Badge label={`#${listing.cardNumber}`} />}
          <Badge label={listing.isGraded ? `${listing.gradingCompany} ${listing.grade}` : listing.condition} />
        </View>

        {listing.sellerUsername && (
          <ThemedText type="small" themeColor="textSecondary">
            Sold by {listing.sellerUsername}
          </ThemedText>
        )}
      </View>

      {listing.format === 'auction' ? (
        <BidBox listing={listing} onBidPlaced={(updated) => setListing({ ...listing, ...updated })} />
      ) : (
        <View style={styles.buyBox}>
          <ThemedText type="subtitle">
            {listing.priceCents != null ? formatPrice(listing.priceCents) : '—'}
          </ThemedText>
          <View style={styles.disabledButton}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Buy It Now — coming soon
            </ThemedText>
          </View>
        </View>
      )}
    </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scrollContent: { paddingBottom: Spacing.six },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    marginTop: -Radius.xl,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.light.surface,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  title: { fontSize: 22, lineHeight: 28 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  badge: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.backgroundElement,
  },
  buyBox: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  disabledButton: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: Colors.light.backgroundElement,
  },
});
