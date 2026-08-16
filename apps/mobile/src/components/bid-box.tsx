import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { placeBid } from '@/lib/api';
import { formatPrice, formatTimeLeft, type Listing, type MyBid } from '@/lib/types';

// The inline box in the scroll content is a trigger, not a real input —
// tapping it (or the amount "field") opens a floating panel in a Modal
// (which renders in its own native layer, fixed to the screen regardless of
// where this component sits inside a ScrollView) holding the actual
// TextInput, docked right above the keyboard. This exists because a plain
// KeyboardAvoidingView wasn't enough: the bid box sits well down the page
// (after the photo gallery, title, badges), so even with the ScrollView
// nudged up, the keyboard could still cover the price/bid-count context
// above the input — the whole point of seeing that panel while typing a
// max bid. A floating, always-fully-visible panel sidesteps needing the
// scroll position and keyboard height to line up perfectly.
//
// Real keyboard height/timing (not a guessed duration) drives the slide, so
// the panel's animation actually matches the system keyboard's own rise —
// iOS's keyboardWillShow/Hide events include both.
export function BidBox({
  listing,
  myBid,
  onBidPlaced,
}: {
  listing: Listing;
  myBid?: MyBid;
  onBidPlaced: (updated: Partial<Listing>) => void;
}) {
  const router = useRouter();
  const { session } = useSession();
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [floating, setFloating] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const inputRef = useRef<TextInput>(null);

  const panelY = useSharedValue(400);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      panelY.value = withTiming(0, {
        duration: e.duration || 280,
        easing: Easing.out(Easing.cubic),
      });
    });
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      panelY.value = withTiming(
        400,
        { duration: e.duration || 220, easing: Easing.in(Easing.cubic) },
        (finished) => {
          'worklet';
          // Only actually unmount the Modal once the slide-down has fully
          // played out — setting `floating` false the instant the keyboard
          // starts hiding would cut the animation short via Modal's own
          // (separate, faster) exit instead of letting this one finish.
          if (finished) runOnJS(setFloating)(false);
        },
      );
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [panelY]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: panelY.value }],
  }));

  const currentPrice = listing.currentPriceCents ?? listing.startingBidCents ?? 0;
  const ended = listing.endsAt ? new Date(listing.endsAt).getTime() <= Date.now() : false;

  function openFloating() {
    setFloating(true);
    // The Modal (and the real TextInput inside it) doesn't exist until this
    // render commits — focus has to wait a tick for it to actually mount.
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // Doesn't set `floating` false directly — that happens once the
  // keyboard-hide handler's slide-down animation actually finishes, so the
  // Modal stays mounted for the full duration of the animation instead of
  // disappearing via its own separate, faster exit the instant the keyboard
  // starts dismissing.
  function closeFloating() {
    Keyboard.dismiss();
  }

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
      closeFloating();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to place bid');
    } finally {
      setSubmitting(false);
    }
  }

  // Mirrors apps/web/app/checkout/[id]/page.tsx's isWonAwaitingPayment
  // derivation exactly — a display/routing concern only, never trusted as
  // authoritative (checkout-intent.go re-derives this itself server-side).
  const wonAwaitingPayment =
    listing.outcome === 'sold' && listing.highBidderId === session?.user.id && !listing.paidAt;

  if (ended) {
    if (wonAwaitingPayment) {
      return (
        <View style={styles.box}>
          <ThemedText type="smallBold" style={styles.won}>
            You won this auction!
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Final price: {formatPrice(currentPrice)}
          </ThemedText>
          <Pressable
            style={styles.buyNowButton}
            onPress={() => router.push(`/checkout/${listing.id}`)}>
            <ThemedText type="smallBold" style={styles.buyNowButtonText}>
              Pay {formatPrice(currentPrice)} now
            </ThemedText>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.box}>
        <ThemedText type="smallBold">Auction ended</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Final price: {formatPrice(currentPrice)}
        </ThemedText>
      </View>
    );
  }

  const winning = myBid?.status === 'winning';

  return (
    <>
      <View style={styles.box}>
        <ThemedText type="subtitle">{formatPrice(currentPrice)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {listing.bidCount ?? 0} bids · {listing.endsAt ? formatTimeLeft(listing.endsAt) : ''}
        </ThemedText>

        {winning && (
          <View style={styles.winningBadge}>
            <ThemedText numberOfLines={1} style={styles.winningBadgeText}>
              You&rsquo;re Top Bidder · {formatPrice(myBid!.myMaxBidCents)}
            </ThemedText>
          </View>
        )}

        <View style={styles.row}>
          <Pressable style={styles.inputTrigger} onPress={openFloating}>
            <ThemedText themeColor={amount ? 'text' : 'textSecondary'} style={styles.inputTriggerText}>
              {amount ? `$${amount}` : 'Your max bid ($)'}
            </ThemedText>
          </Pressable>
          <Pressable style={styles.button} onPress={openFloating}>
            <ThemedText type="smallBold" style={styles.buttonText}>
              Bid
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

      {listing.buyItNowPriceCents != null && (
        <View style={styles.buyNowBox}>
          <Pressable
            style={styles.buyNowButton}
            onPress={() => router.push(`/checkout/${listing.id}`)}>
            <ThemedText type="smallBold" style={styles.buyNowButtonText}>
              Buy It Now for {formatPrice(listing.buyItNowPriceCents)}
            </ThemedText>
          </Pressable>
        </View>
      )}

      <Modal transparent visible={floating} animationType="fade" onRequestClose={closeFloating}>
        <Pressable style={styles.backdrop} onPress={closeFloating} accessibilityLabel="Close bid panel" />
        <Animated.View
          style={[styles.floatingPanel, panelStyle, { paddingBottom: keyboardHeight + Spacing.three }]}>
          <View style={styles.floatingHandle} />
          <ThemedText type="subtitle">{formatPrice(currentPrice)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {listing.bidCount ?? 0} bids · {listing.endsAt ? formatTimeLeft(listing.endsAt) : ''}
          </ThemedText>

          <View style={styles.row}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Your max bid ($)"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              onSubmitEditing={handleBid}
              returnKeyType="done"
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
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: Spacing.one,
    marginHorizontal: Spacing.two,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  buyNowBox: {
    marginHorizontal: Spacing.two,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  buyNowButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: Brand.gold,
  },
  buyNowButtonText: { color: '#ffffff' },
  won: { color: '#2E9E5B' },
  // Same pill as ListingCard's/ListingRow's winning badge (bg #2E9E5B,
  // white bold text) — every place this badge shows up in the app now
  // looks alike.
  winningBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
    backgroundColor: '#2E9E5B',
  },
  winningBadgeText: { color: '#ffffff', fontSize: 9, lineHeight: 11, fontWeight: '700' },
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
  inputTrigger: {
    flex: 1,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  inputTriggerText: { fontSize: 16 },
  button: {
    backgroundColor: Brand.navy,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
  },
  buttonText: { color: '#ffffff' },
  error: { color: '#D64545' },
  success: { color: '#2E9E5B' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  floatingPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: Spacing.two,
    padding: Spacing.four,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  floatingHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.light.backgroundSelected,
    marginBottom: Spacing.one,
  },
});
