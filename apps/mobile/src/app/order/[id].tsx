import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClaimPanel } from '@/components/claim-panel';
import { OrderTimeline } from '@/components/order-timeline';
import { RateSellerForm } from '@/components/rate-seller-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import {
  addOrderEvidence,
  getListing,
  getOrderForListing,
  getReviewablePurchases,
  shipOrder,
} from '@/lib/api';
import { uploadOrderEvidence } from '@/lib/storage';
import { formatPrice, type EvidenceType, type Listing, type Order } from '@/lib/types';

const REQUIRED_EVIDENCE: { type: EvidenceType; label: string }[] = [
  { type: 'card_front', label: 'Card — front' },
  { type: 'card_back', label: 'Card — back' },
  { type: 'package_sealed', label: 'Sealed package with label' },
];

async function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    function fromCamera() {
      ImagePicker.requestCameraPermissionsAsync().then((perm) => {
        if (!perm.granted) {
          Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.');
          resolve(null);
          return;
        }
        ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 }).then((result) => {
          resolve(!result.canceled && result.assets[0] ? result.assets[0].uri : null);
        });
      });
    }
    function fromLibrary() {
      ImagePicker.requestMediaLibraryPermissionsAsync().then((perm) => {
        if (!perm.granted) {
          Alert.alert('Photo library access needed', 'Enable photo access in Settings to choose a photo.');
          resolve(null);
          return;
        }
        ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 }).then((result) => {
          resolve(!result.canceled && result.assets[0] ? result.assets[0].uri : null);
        });
      });
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
        (index) => {
          if (index === 1) fromCamera();
          else if (index === 2) fromLibrary();
          else resolve(null);
        },
      );
    } else {
      Alert.alert('Add photo', undefined, [
        { text: 'Take Photo', onPress: fromCamera },
        { text: 'Choose from Library', onPress: fromLibrary },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
}

// The mobile counterpart to apps/web's order confirmation page +
// OrderStatusPanel + ClaimPanel — mobile had NO order-detail screen at
// all before this (checkout/[id].tsx just replaces straight back to the
// listing on success, see its own router.replace call). Reached from
// transactions.tsx's list, and is what makes the Transactions tab useful
// beyond just a list of bubbles: full timeline, seller fulfillment
// (evidence upload + mark shipped), buyer arrival-photo prompt, claim
// panel for disputes, and — new — a "rate this seller" prompt once the
// buyer's order is fully released, closing the gap seller/[username].tsx's
// own doc comment used to call out (no review-writing flow on mobile).
export default function OrderDetailScreen() {
  const { id: listingId } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const [listing, setListing] = useState<Listing | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [reviewed, setReviewed] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [l, o] = await Promise.all([getListing(listingId), getOrderForListing(listingId)]);
      setListing(l);
      setOrder(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load this order');
    }
  }, [listingId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const viewerId = session?.user.id;
  const viewerIsSeller = !!listing && listing.sellerId === viewerId;
  const viewerIsBuyer = !!listing && !viewerIsSeller;

  useEffect(() => {
    if (!listing || !order || !viewerIsBuyer || order.state !== 'released' || !listing.sellerUsername) {
      setCanReview(false);
      return;
    }
    getReviewablePurchases(listing.sellerUsername).then((eligible) => {
      setCanReview(eligible.some((e) => e.listingId === listingId));
    });
  }, [listing, order, viewerIsBuyer, listingId]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (error || !listing || !order) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ title: 'Order' }} />
        <ThemedText type="small" themeColor="textSecondary">
          {error ?? 'No order found for this listing.'}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: listing.title }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              {listing.imageUrls[0] ? (
                <Image source={listing.imageUrls[0]} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={styles.thumbPlaceholder} />
              )}
              <View style={styles.summaryInfo}>
                <ThemedText type="smallBold" numberOfLines={2}>
                  {listing.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {viewerIsSeller
                    ? `Selling to ${listing.buyerUsername ?? 'buyer'}`
                    : `Buying from ${listing.sellerUsername ?? 'seller'}`}
                </ThemedText>
              </View>
              <ThemedText type="smallBold">{formatPrice(order.chargedCents)}</ThemedText>
            </View>

            <OrderTimeline state={order.state} />

            {order.trackingNumber && (
              <ThemedText type="small" themeColor="textSecondary">
                {order.carrier} tracking: <ThemedText type="smallBold">{order.trackingNumber}</ThemedText>
              </ThemedText>
            )}
            {order.state === 'claim_window' && order.claimDeadline && (
              <ThemedText type="small" themeColor="textSecondary">
                Funds release to the seller on{' '}
                {new Date(order.claimDeadline).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}{' '}
                unless a claim is opened first.
              </ThemedText>
            )}
          </View>

          {viewerIsSeller && order.state === 'awaiting_ship' && (
            <SellerFulfillment order={order} listingId={listingId} onShipped={setOrder} />
          )}

          {viewerIsBuyer && order.state === 'delivered' && (
            <ArrivalPhotoPrompt orderId={order.id} listingId={listingId} />
          )}

          {viewerIsBuyer && canReview && !reviewed && listing.sellerUsername && (
            <RateSellerForm
              sellerUsername={listing.sellerUsername}
              listingId={listingId}
              onDone={() => setReviewed(true)}
            />
          )}
          {viewerIsBuyer && reviewed && (
            <ThemedText type="small" style={styles.success}>
              Thanks for your review.
            </ThemedText>
          )}

          <ClaimPanel
            listingId={listingId}
            orderId={order.id}
            orderState={order.state}
            viewerIsSeller={viewerIsSeller}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SellerFulfillment({
  order,
  listingId,
  onShipped,
}: {
  order: Order;
  listingId: string;
  onShipped: (order: Order) => void;
}) {
  const [uploaded, setUploaded] = useState<Set<EvidenceType>>(new Set());
  const [busyType, setBusyType] = useState<EvidenceType | null>(null);
  const [carrier, setCarrier] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload(type: EvidenceType) {
    const uri = await pickPhoto();
    if (!uri) return;
    setBusyType(type);
    setError('');
    try {
      const url = await uploadOrderEvidence(order.id, uri);
      await addOrderEvidence(listingId, type, url);
      setUploaded((prev) => new Set(prev).add(type));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusyType(null);
    }
  }

  const allUploaded = REQUIRED_EVIDENCE.every((e) => uploaded.has(e.type));

  function pickCarrier() {
    const options = ['Cancel', 'USPS', 'UPS', 'FedEx'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 0 }, (index) => {
        if (index > 0) setCarrier(options[index]);
      });
    } else {
      Alert.alert(
        'Carrier',
        undefined,
        options.slice(1).map((label) => ({ text: label, onPress: () => setCarrier(label) })),
      );
    }
  }

  async function handleShip() {
    if (!carrier || !trackingNumber) return;
    setShipping(true);
    setError('');
    try {
      const updated = await shipOrder(listingId, carrier, trackingNumber);
      onShipped(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setShipping(false);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <SymbolView name="shippingbox" size={16} tintColor={Brand.navy} fallback={null} />
        <ThemedText type="smallBold">Fulfill this order</ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Upload proof photos, then enter tracking to mark this shipped.
      </ThemedText>

      {REQUIRED_EVIDENCE.map(({ type, label }) => (
        <View key={type} style={styles.evidenceRow}>
          <ThemedText type="small">{label}</ThemedText>
          {uploaded.has(type) ? (
            <View style={styles.uploadedBadge}>
              <SymbolView name="checkmark.circle.fill" size={14} tintColor="#2E9E5B" fallback={null} />
              <ThemedText type="small" style={styles.success}>
                Uploaded
              </ThemedText>
            </View>
          ) : (
            <Pressable onPress={() => handleUpload(type)} disabled={busyType === type}>
              {busyType === type ? (
                <ActivityIndicator size="small" />
              ) : (
                <ThemedText type="small" style={styles.link}>
                  Upload
                </ThemedText>
              )}
            </Pressable>
          )}
        </View>
      ))}

      {allUploaded && (
        <Pressable style={styles.carrierPicker} onPress={pickCarrier}>
          <ThemedText type="small">{carrier ?? 'Carrier'}</ThemedText>
        </Pressable>
      )}
      {allUploaded && (
        <TextInput
          value={trackingNumber}
          onChangeText={setTrackingNumber}
          placeholder="Tracking number"
          placeholderTextColor={Colors.light.textSecondary}
          style={styles.trackingInput}
        />
      )}
      {allUploaded && (
        <Pressable
          style={styles.shipButton}
          disabled={shipping || !carrier || !trackingNumber}
          onPress={handleShip}>
          <SymbolView name="truck.box" size={14} tintColor="#ffffff" fallback={null} />
          <ThemedText type="smallBold" style={styles.buttonLabelLight}>
            {shipping ? 'Marking shipped…' : 'Mark as shipped'}
          </ThemedText>
        </Pressable>
      )}
      {error !== '' && (
        <ThemedText type="small" style={styles.errorText}>
          {error}
        </ThemedText>
      )}
    </View>
  );
}

function ArrivalPhotoPrompt({ orderId, listingId }: { orderId: string; listingId: string }) {
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload() {
    const uri = await pickPhoto();
    if (!uri) return;
    setBusy(true);
    setError('');
    try {
      const url = await uploadOrderEvidence(orderId, uri);
      await addOrderEvidence(listingId, 'arrival_photo', url);
      setUploaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  if (uploaded) {
    return (
      <View style={styles.section}>
        <ThemedText type="small" style={styles.success}>
          Arrival photo saved — thanks!
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <ThemedText type="small">
        Photograph the package before unpacking — buyers who do get expedited claim handling if anything&rsquo;s
        wrong.
      </ThemedText>
      <Pressable onPress={handleUpload} disabled={busy}>
        <ThemedText type="small" style={styles.link}>
          {busy ? 'Uploading…' : 'Add a photo (optional)'}
        </ThemedText>
      </Pressable>
      {error !== '' && (
        <ThemedText type="small" style={styles.errorText}>
          {error}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  summaryCard: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumb: { width: 56, height: 56, borderRadius: Radius.md },
  thumbPlaceholder: { width: 56, height: 56, borderRadius: Radius.md, backgroundColor: Colors.light.backgroundElement },
  summaryInfo: { flex: 1, gap: 2 },
  section: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  evidenceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  uploadedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  link: { color: Brand.navy, fontWeight: '600' },
  success: { color: '#2E9E5B', fontWeight: '600' },
  errorText: { color: '#D64545' },
  carrierPicker: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
  },
  trackingInput: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    padding: Spacing.two,
    fontSize: 14,
    color: Colors.light.text,
  },
  shipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.full,
    backgroundColor: Brand.gold,
  },
  buttonLabelLight: { color: '#ffffff' },
});
