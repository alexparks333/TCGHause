import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { placeBid } from '@/lib/api';
import { formatPrice, formatTimeLeft, type Listing } from '@/lib/types';

export function BidBox({
  listing,
  onBidPlaced,
}: {
  listing: Listing;
  onBidPlaced: (updated: Partial<Listing>) => void;
}) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentPrice = listing.currentPriceCents ?? listing.startingBidCents ?? 0;
  const ended = listing.endsAt ? new Date(listing.endsAt).getTime() <= Date.now() : false;

  async function handleBid() {
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter a valid dollar amount');
      return;
    }
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const result = await placeBid(listing.id, Math.round(dollars * 100));
      onBidPlaced({
        currentPriceCents: result.currentPriceCents,
        highBidderId: result.highBidderId,
        bidCount: result.bidCount,
        endsAt: result.endsAt,
      });
      setSuccess(
        result.youAreHighBidder
          ? `You're the top bidder — winning up to ${amount ? `$${amount}` : ''}`
          : 'Bid placed, but you were outbid immediately (someone else has a higher max)',
      );
      setAmount('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to place bid');
    } finally {
      setSubmitting(false);
    }
  }

  if (ended) {
    return (
      <View style={styles.box}>
        <ThemedText type="smallBold">Auction ended</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Final price: {formatPrice(currentPrice)}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <ThemedText type="subtitle">{formatPrice(currentPrice)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {listing.bidCount ?? 0} bids · {listing.endsAt ? formatTimeLeft(listing.endsAt) : ''}
      </ThemedText>

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Your max bid ($)"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <Pressable style={styles.button} onPress={handleBid} disabled={submitting}>
          <ThemedText type="smallBold" style={styles.buttonText}>
            {submitting ? '…' : 'Bid'}
          </ThemedText>
        </Pressable>
      </View>

      {error && (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      )}
      {success && (
        <ThemedText type="small" style={styles.success}>
          {success}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: Spacing.two,
    margin: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  row: { flexDirection: 'row', gap: Spacing.two },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  button: {
    backgroundColor: Brand.navy,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
  },
  buttonText: { color: '#ffffff' },
  error: { color: '#D64545' },
  success: { color: '#2E9E5B' },
});
