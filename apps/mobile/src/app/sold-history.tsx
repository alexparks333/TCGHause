import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getMySales } from '@/lib/api';
import { formatPrice, purchaseDate, purchasePriceCents, type Listing } from '@/lib/types';

// Mirrors apps/web's Sold History page (app/account/sold-history +
// PurchaseHistoryTable role="selling") exactly in content — same data
// (getMySales), same fields (item/game/set, price, buyer, date, payment
// status) — laid out as a row list instead of a table, same shape bids.tsx
// already uses for its own history-style list. Buyer's username is a real
// link to /seller/[username], same as web (and same as buy-history.tsx's
// seller link — that profile screen exists now, see app/seller/[username].tsx).
export default function SoldHistoryScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [sales, setSales] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSales(await getMySales());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sold history');
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
            Everything you&rsquo;ve sold, whether you&rsquo;ve been paid for it yet or not.
          </ThemedText>
        </View>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}
        {!loading && sales.length === 0 && !error && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            You haven&rsquo;t sold anything yet.
          </ThemedText>
        )}

        <FlatList
          data={sales}
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
                    {item.buyerUsername ? (
                      <>
                        Buyer:{' '}
                        <ThemedText
                          type="small"
                          style={styles.buyerLink}
                          onPress={(e) => {
                            e.stopPropagation();
                            router.push(`/seller/${item.buyerUsername}`);
                          }}>
                          {item.buyerUsername}
                        </ThemedText>
                      </>
                    ) : (
                      'Buyer'
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
  buyerLink: { fontWeight: '700', textDecorationLine: 'underline' },
  rowRight: { alignItems: 'flex-end', gap: Spacing.one },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.full },
  badgePaid: { backgroundColor: 'rgba(46,158,91,0.1)' },
  badgeUnpaid: { backgroundColor: 'rgba(214,69,69,0.1)' },
  badgeTextPaid: { color: '#2E9E5B', fontWeight: '600', fontSize: 11 },
  badgeTextUnpaid: { color: '#D64545', fontWeight: '600', fontSize: 11 },
});
