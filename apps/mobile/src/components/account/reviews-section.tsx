import { StyleSheet, View } from 'react-native';

import { StarRating } from '@/components/account/star-rating';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Review } from '@/lib/api';

export function ReviewsSection({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No reviews yet.
      </ThemedText>
    );
  }

  return (
    <View style={styles.list}>
      {reviews.map((review) => (
        <View key={review.id} style={styles.item}>
          <View style={styles.itemHeader}>
            <ThemedText type="smallBold">{review.reviewerUsername ?? 'A buyer'}</ThemedText>
            <StarRating rating={review.overallRating} size={13} />
          </View>
          {review.comment && <ThemedText type="small">{review.comment}</ThemedText>}
          <ThemedText type="small" themeColor="textSecondary">
            {new Date(review.createdAt).toLocaleDateString()}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  item: {
    gap: 2,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#00000022',
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
