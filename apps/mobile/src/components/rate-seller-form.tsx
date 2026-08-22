import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { submitReview } from '@/lib/api';

const AXES = [
  { key: 'conditionAccuracy', label: 'Condition Accuracy' },
  { key: 'shippingSpeed', label: 'Shipping Speed' },
  { key: 'trustworthiness', label: 'Trustworthiness' },
] as const;

type AxisKey = (typeof AXES)[number]['key'];

function StarPicker({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <View style={styles.axisWrap}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} hitSlop={6} onPress={() => onChange(n)}>
            <ThemedText style={[styles.star, { opacity: n <= value ? 1 : 0.25 }]}>★</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// The mobile counterpart to apps/web's ReviewForm.tsx — didn't exist
// before (see seller/[username].tsx's doc comment: "no review-writing
// form, unlike web ... reviews are only ever left from a completed
// purchase flow, which doesn't exist here yet"). Now that order/[id].tsx
// is a real completed-purchase flow, this closes that gap. Scoped to one
// listing at a time (the order screen already knows which purchase this
// is), unlike web's picker-across-multiple-purchases version — order/[id]
// only ever shows this for the specific listing it's the order for.
export function RateSellerForm({
  sellerUsername,
  listingId,
  onDone,
}: {
  sellerUsername: string;
  listingId: string;
  onDone: () => void;
}) {
  const [ratings, setRatings] = useState<Record<AxisKey, number>>({
    conditionAccuracy: 0,
    shippingSpeed: 0,
    trustworthiness: 0,
  });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (AXES.some((axis) => ratings[axis.key] < 1)) {
      setError('Rate all three categories.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await submitReview(sellerUsername, { listingId, ...ratings, comment: comment || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.card}>
      <ThemedText type="smallBold">Rate this seller</ThemedText>
      {AXES.map((axis) => (
        <StarPicker
          key={axis.key}
          label={axis.label}
          value={ratings[axis.key]}
          onChange={(n) => setRatings((r) => ({ ...r, [axis.key]: n }))}
        />
      ))}
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Leave a comment (optional)"
        placeholderTextColor={Colors.light.textSecondary}
        multiline
        style={styles.input}
      />
      {error !== '' && (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      )}
      <Pressable
        style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed]}
        disabled={submitting}
        onPress={handleSubmit}>
        <ThemedText type="smallBold" style={styles.submitLabel}>
          {submitting ? 'Submitting…' : 'Submit review'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  axisWrap: { gap: 4 },
  starRow: { flexDirection: 'row', gap: 4 },
  star: { fontSize: 22, color: Brand.gold },
  input: {
    minHeight: 60,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    padding: Spacing.two,
    fontSize: 14,
    textAlignVertical: 'top',
    color: Colors.light.text,
  },
  error: { color: '#D64545' },
  submitButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.full,
    backgroundColor: Brand.gold,
  },
  submitButtonPressed: { opacity: 0.85 },
  submitLabel: { color: '#ffffff' },
});
