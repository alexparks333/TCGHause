import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TransactionBubbles } from '@/components/transaction-bubbles';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getMyOrders } from '@/lib/api';
import { formatPrice, type OrderSummary } from '@/lib/types';

// Mirrors apps/web's Transactions page (app/account/transactions +
// TransactionsList) exactly — every order the caller is a participant in,
// buyer or seller side, each row showing real progress via
// TransactionBubbles instead of Selling's flat "Sold"/"Paid" badge. Rows
// push to order/[id], the detail screen with the full timeline and
// fulfillment/claim actions. Reachable only from the account sidebar, same
// as Selling/Sold History/Buy History.
export default function TransactionsScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setOrders(await getMyOrders());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load, session?.user.id]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.subtitleWrap}>
          <ThemedText style={styles.subtitle}>
            Track every purchase and sale from payment through delivery.
          </ThemedText>
        </View>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}
        {!loading && orders.length === 0 && !error && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No transactions yet — they show up here once you buy or sell something.
          </ThemedText>
        )}

        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
          renderItem={({ item }) => {
            const roleLabel = item.viewerIsSeller ? 'Selling to' : 'Buying from';
            const amountCents = item.viewerIsSeller ? item.sellerNetCents : item.chargedCents;
            const amountLabel = item.viewerIsSeller ? "You'll receive" : 'You paid';
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push(`/order/${item.listingId}`)}>
                <View style={styles.topRow}>
                  {item.listingImageUrl ? (
                    <Image source={item.listingImageUrl} style={styles.thumb} contentFit="cover" />
                  ) : (
                    <View style={styles.thumbPlaceholder} />
                  )}
                  <View style={styles.info}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {item.listingTitle}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {roleLabel} {item.counterpartyUsername ?? 'them'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {amountLabel} <ThemedText type="smallBold">{formatPrice(amountCents)}</ThemedText>
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.bubbleRow}>
                  <TransactionBubbles state={item.state} />
                </View>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  subtitleWrap: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.one },
  subtitle: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  list: { padding: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.six },
  error: { color: '#D64545', paddingHorizontal: Spacing.three, marginTop: Spacing.two },
  empty: { padding: Spacing.four, textAlign: 'center' },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    gap: Spacing.two,
    ...CardShadow,
  },
  cardPressed: { opacity: 0.85 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumb: { width: 52, height: 52, borderRadius: Radius.md },
  thumbPlaceholder: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.light.backgroundElement },
  info: { flex: 1, gap: 2 },
  bubbleRow: { paddingLeft: 2 },
});
