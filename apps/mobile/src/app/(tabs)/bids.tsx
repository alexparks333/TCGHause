import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getMyBids } from '@/lib/api';
import { formatPrice, formatTimeLeft, type MyBid } from '@/lib/types';

export default function MyBidsScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [bids, setBids] = useState<MyBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setBids(await getMyBids());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your bids');
    }
  }, []);

  // Keyed on the signed-in user's id, not just mount — otherwise switching
  // accounts (dev quick switch, or a real sign-out/sign-in) leaves this
  // screen showing whichever account's data it happened to load first,
  // since the previous version's effect had no dependency on identity at
  // all and therefore only ever ran once.
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
      <SafeAreaView style={styles.container} edges={['top']}>
        <ThemedText type="title" style={styles.header}>
          My Bids
        </ThemedText>
        <View style={styles.subtitleWrap}>
          <ThemedText style={styles.subtitle}>
            Your active bid amounts across every auction you&rsquo;re in.
          </ThemedText>
        </View>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}
        {!loading && bids.length === 0 && !error && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            You haven&rsquo;t placed any bids yet.
          </ThemedText>
        )}

        <FlatList
          data={bids}
          keyExtractor={(item) => item.listing.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
          renderItem={({ item }) => {
            // A closed, won auction you haven't paid for yet — mirrors
            // apps/web/app/checkout/[id]/page.tsx's isWonAwaitingPayment
            // (item.status stays 'winning' once an auction closes with you
            // as the buyer; outcome/paidAt are what actually distinguish
            // "won, still owe money" from "still live, currently ahead").
            const wonAwaitingPayment =
              item.status === 'winning' && item.listing.outcome === 'sold' && !item.listing.paidAt;

            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() =>
                  router.push(
                    wonAwaitingPayment ? `/checkout/${item.listing.id}` : `/listing/${item.listing.id}`,
                  )
                }>
                <View style={styles.rowInfo}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.listing.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Your max: {formatPrice(item.myMaxBidCents)}
                    {item.listing.endsAt ? ` · ${formatTimeLeft(item.listing.endsAt)}` : ''}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.badge,
                    wonAwaitingPayment
                      ? styles.badgePayNow
                      : item.status === 'winning'
                        ? styles.badgeWinning
                        : styles.badgeOutbid,
                  ]}>
                  <ThemedText
                    type="small"
                    style={
                      wonAwaitingPayment
                        ? styles.badgeTextPayNow
                        : item.status === 'winning'
                          ? styles.badgeTextWinning
                          : styles.badgeTextOutbid
                    }>
                    {wonAwaitingPayment ? 'Pay now' : item.status === 'winning' ? 'Winning' : 'Outbid'}
                  </ThemedText>
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
  header: { fontSize: 28, lineHeight: 34, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  subtitleWrap: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.three },
  subtitle: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: Colors.light.textSecondary,
  },
  list: { padding: Spacing.three, paddingTop: 0, paddingBottom: Spacing.six },
  error: { color: '#D64545', paddingHorizontal: Spacing.three },
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
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radius.full },
  badgeWinning: { backgroundColor: 'rgba(46,158,91,0.1)' },
  badgeOutbid: { backgroundColor: 'rgba(214,69,69,0.1)' },
  badgeTextWinning: { color: '#2E9E5B', fontWeight: '600', fontSize: 11 },
  badgeTextOutbid: { color: '#D64545', fontWeight: '600', fontSize: 11 },
  badgePayNow: { backgroundColor: 'rgba(184,134,11,0.12)' },
  badgeTextPayNow: { color: Brand.gold, fontWeight: '600', fontSize: 11 },
});
