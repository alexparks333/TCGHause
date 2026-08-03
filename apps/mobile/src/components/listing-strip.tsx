import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { ListingCard } from '@/components/listing-card';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { Listing, MyBid } from '@/lib/types';

export function ListingStrip({
  title,
  listings,
  watchedIds,
  myBidsByListingId,
  onToggleWatch,
}: {
  title: string;
  listings: Listing[];
  watchedIds: Set<string>;
  myBidsByListingId: Map<string, MyBid>;
  onToggleWatch: (listingId: string) => void;
}) {
  const router = useRouter();

  if (listings.length === 0) return null;

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" style={styles.title}>
        {title}
      </ThemedText>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={listings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            onPress={() => router.push(`/listing/${item.id}`)}
            watching={watchedIds.has(item.id)}
            onToggleWatch={() => onToggleWatch(item.id)}
            myBid={myBidsByListingId.get(item.id)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: Spacing.four },
  title: {
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    fontSize: 17,
    color: Brand.navy,
  },
  row: { paddingHorizontal: Spacing.three, gap: Spacing.three },
});
