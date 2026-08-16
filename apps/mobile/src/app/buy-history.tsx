import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getMyPurchases } from '@/lib/api';
import { formatPrice, purchaseDate, purchasePriceCents, type Listing } from '@/lib/types';

// Mirrors apps/web's Buy History page (app/account/buy-history +
// PurchaseHistoryTable role="buying") exactly in content — same data
// (getMyPurchases), same fields (item/game/set, price, seller, date,
// payment status) — laid out as a row list instead of a table, same shape
// sold-history.tsx already uses for its own history-style list (this is
// its buyer-side mirror image, "Seller" instead of "Buyer"). Seller's
// username is a real link to /seller/[username], same as web.
export default function BuyHistoryScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [purchases, setPurchases] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setPurchases(await getMyPurchases());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load buy history');
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
            Everything you&rsquo;ve bought, whether it&rsquo;s been paid for yet or not.
          </ThemedText>
        </View>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}
        {!loading && purchases.length === 0 && !error && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            You haven&rsquo;t bought anything yet.
          </ThemedText>
        )}

        <FlatList
          data={purchases}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
          renderItem={({ item }) => {
            const date = purchaseDate(item);
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push(`/listing/${item.id}`)}>
                <View style={styles.rowInfo}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.game} · {item.set}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.sellerUsername ? (
                      <>
                        Seller:{' '}
                        <ThemedText
                          type="small"
                          style={styles.sellerLink}
                          onPress={(e) => {
                            e.stopPropagation();
                            router.push(`/seller/${item.sellerUsername}`);
                          }}>
                          {item.sellerUsername}
                        </ThemedText>
                      </>
                    ) : (
                      'Seller'
                    )}
                    {date
                      ? ` · ${new Date(date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}`
                      : ''}
                  </ThemedText>
                </View>
                <View style={styles.rowRight}>
                  <ThemedText type="smallBold">{formatPrice(purchasePriceCents(item))}</ThemedText>
                  <View style={[styles.badge, item.paidAt ? styles.badgePaid : styles.badgeUnpaid]}>
                    <ThemedText
                      type="small"
                      style={item.paidAt ? styles.badgeTextPaid : styles.badgeTextUnpaid}>
                      {item.paidAt ? 'Paid' : 'Awaiting payment'}
                    </ThemedText>
                  </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  cardPressed: { opacity: 0.85 },
  rowInfo: { flex: 1, gap: 2, marginRight: Spacing.two },
  sellerLink: { fontWeight: '700', textDecorationLine: 'underline' },
  rowRight: { alignItems: 'flex-end', gap: Spacing.one },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.full },
  badgePaid: { backgroundColor: 'rgba(46,158,91,0.1)' },
  badgeUnpaid: { backgroundColor: 'rgba(214,69,69,0.1)' },
  badgeTextPaid: { color: '#2E9E5B', fontWeight: '600', fontSize: 11 },
  badgeTextUnpaid: { color: '#D64545', fontWeight: '600', fontSize: 11 },
});
