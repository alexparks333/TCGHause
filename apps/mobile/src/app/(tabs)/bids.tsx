import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}
        {!loading && bids.length === 0 && !error && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            You haven't placed any bids yet.
          </ThemedText>
        )}

        <FlatList
          data={bids}
          keyExtractor={(item) => item.listing.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/listing/${item.listing.id}`)}>
              <View style={styles.rowInfo}>
                <ThemedText type="small" numberOfLines={1}>
                  {item.listing.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Your max: {formatPrice(item.myMaxBidCents)}
                  {item.listing.endsAt ? ` · ${formatTimeLeft(item.listing.endsAt)}` : ''}
                </ThemedText>
              </View>
              <ThemedText
                type="smallBold"
                style={item.status === 'winning' ? styles.winning : styles.outbid}>
                {item.status === 'winning' ? 'Winning' : 'Outbid'}
              </ThemedText>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { fontSize: 28, lineHeight: 34, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six },
  error: { color: '#D64545', paddingHorizontal: Spacing.three },
  empty: { padding: Spacing.four, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#00000022',
  },
  rowInfo: { flex: 1, gap: 2, marginRight: Spacing.two },
  winning: { color: '#2E9E5B' },
  outbid: { color: '#D64545' },
});
