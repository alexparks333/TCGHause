import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { ApiError, buyNow, createCheckoutIntent, getListing, type CheckoutIntent } from '@/lib/api';
import { formatPrice, type Listing } from '@/lib/types';

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

// Mirrors apps/web/app/checkout/[id]/page.tsx + MockCheckout.tsx's card
// path — v1 scope is card-only, no saved-payment-method picker, no ACH
// (see CLAUDE.md-style reasoning in lib/api.ts's checkout section). One
// screen handles BOTH Buy-It-Now and paying for a won auction, exactly
// like web: the backend decides which via the same listing state either
// way (checkout-intent.go re-derives this itself — this screen's own
// derivation below is a display/amount concern only, never trusted as
// authoritative, same as web's).
function isWonAwaitingPayment(listing: Listing, userId?: string): boolean {
  return (
    listing.format === 'auction' &&
    listing.outcome === 'sold' &&
    listing.highBidderId === userId &&
    !listing.paidAt
  );
}

function priceCentsFor(listing: Listing, userId?: string): number {
  if (isWonAwaitingPayment(listing, userId)) return listing.currentPriceCents ?? 0;
  return listing.format === 'fixed' ? (listing.priceCents ?? 0) : (listing.buyItNowPriceCents ?? 0);
}

// Distinguishes the specific failure reasons the backend actually returns
// (checkout.go/buynow.go) instead of a generic "something went wrong" —
// mirrors MockCheckout.tsx's err.status checks exactly.
function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return 'This item was already sold to someone else.';
    if (e.status === 403) return "You can't buy your own listing.";
    if (e.status === 412) return "The seller hasn't finished setting up payouts yet.";
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();

  const [listing, setListing] = useState<Listing | null>(null);
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const l = await getListing(id);
        if (cancelled) return;
        if (!l) {
          setError('Listing not found');
          return;
        }
        setListing(l);

        if (l.sellerId === session?.user.id) {
          setError("You can't buy your own listing.");
          return;
        }

        const i = await createCheckoutIntent(id);
        if (cancelled) return;
        setIntent(i);
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, session?.user.id]);

  if (!STRIPE_PUBLISHABLE_KEY) {
    return (
      <Centered>
        <ThemedText type="small" themeColor="textSecondary">
          Payments aren&rsquo;t configured yet.
        </ThemedText>
      </Centered>
    );
  }

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator color={Brand.navy} />
      </Centered>
    );
  }

  if (error || !listing || !intent) {
    return (
      <Centered>
        <ThemedText type="small" style={styles.errorText}>
          {error ?? 'Something went wrong.'}
        </ThemedText>
      </Centered>
    );
  }

  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      <PaymentPanel
        listing={listing}
        intent={intent}
        priceCents={priceCentsFor(listing, session?.user.id)}
      />
    </StripeProvider>
  );
}

function PaymentPanel({
  listing,
  intent,
  priceCents,
}: {
  listing: Listing;
  intent: CheckoutIntent;
  priceCents: number;
}) {
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'AuctionHous',
        paymentIntentClientSecret: intent.clientSecret,
        // Card-only in this v1 — no delayed-notification methods (ACH etc.)
        // are offered, so there's nothing to allow here.
        allowsDelayedPaymentMethods: false,
      });
      if (cancelled) return;
      if (initError) setError(initError.message);
      else setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent.clientSecret]);

  async function handlePay() {
    setPaying(true);
    setError(null);
    const { error: presentError } = await presentPaymentSheet();
    if (presentError) {
      setPaying(false);
      // 'Canceled' is the buyer backing out of the sheet themselves — not
      // a real error worth surfacing.
      if (presentError.code !== 'Canceled') setError(presentError.message);
      return;
    }
    // The card is authorized now, NOT charged — presentPaymentSheet
    // succeeding only means Stripe accepted the payment method. buyNow is
    // what actually wins the atomic purchase race and captures the charge
    // (see lib/api.ts's buyNow doc comment) — never treat this point as
    // "purchase complete."
    try {
      await buyNow(listing.id, intent.paymentIntentId);
      setSuccess(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPaying(false);
    }
  }

  if (success) {
    return (
      <Centered>
        <ThemedText type="subtitle">Purchase complete!</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.successBody}>
          {listing.title}
        </ThemedText>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={() => router.replace(`/listing/${listing.id}`)}>
          <ThemedText type="smallBold" style={styles.buttonText}>
            Done
          </ThemedText>
        </Pressable>
      </Centered>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.panel}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {listing.title}
          </ThemedText>
          <ThemedText style={styles.amount}>{formatPrice(priceCents)}</ThemedText>

          {error && (
            <ThemedText type="small" style={styles.errorText}>
              {error}
            </ThemedText>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              (!ready || paying) && styles.buttonDisabled,
              pressed && ready && !paying && styles.pressed,
            ]}
            disabled={!ready || paying}
            onPress={handlePay}>
            <ThemedText type="smallBold" style={styles.buttonText}>
              {paying ? 'Processing…' : ready ? `Pay ${formatPrice(priceCents)}` : 'Loading…'}
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.container, styles.center]}>{children}</SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  panel: {
    margin: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    gap: Spacing.two,
    ...CardShadow,
  },
  amount: { fontSize: 34, lineHeight: 40, fontWeight: '700', color: Colors.light.text },
  button: {
    marginTop: Spacing.two,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Brand.gold,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff' },
  pressed: { opacity: 0.85 },
  errorText: { color: '#D64545' },
  successBody: { textAlign: 'center' },
});
