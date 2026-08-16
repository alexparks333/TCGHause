import { SymbolView } from 'expo-symbols';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getMyThreads, type MessageThreadSummary } from '@/lib/api';
import { formatRelativeTime } from '@/lib/types';

// Mobile counterpart to apps/web/components/messages/MessagesApp.tsx's
// left pane (+ apps/web/app/account/messages/page.tsx). Web's two-pane
// layout collapses to one pane on a narrow viewport; on native that maps
// naturally to two separate stack screens instead (this list, and
// messages/[id].tsx for an open thread) rather than one component
// switching panes.
const THREAD_LIST_POLL_MS = 15000;

export default function MessagesInboxScreen() {
  const router = useRouter();
  const { session } = useSession();
  const [threads, setThreads] = useState<MessageThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getMyThreads();
      setThreads(data.threads);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    }
  }, []);

  // Same "poll while this screen is actually the one on screen" reasoning
  // as web's setInterval-for-the-lifetime-of-the-mounted-component, but
  // scoped to focus (not mount) — NativeTabs/stack screens don't unmount on
  // navigation away the way a web component does on route change, so a
  // mount-only interval would keep polling an inbox nobody's looking at.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
      pollRef.current = setInterval(load, THREAD_LIST_POLL_MS);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, session?.user.id]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        {!loading && threads.length === 0 && !error && (
          <View style={styles.empty}>
            <SymbolView name="bubble.left.and.bubble.right" size={28} tintColor={Colors.light.textSecondary} fallback={null} />
            <ThemedText type="smallBold" style={styles.emptyTitle}>
              No messages yet
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptySubtitle}>
              Tap &ldquo;Message Seller&rdquo; on a listing to start a conversation.
            </ThemedText>
          </View>
        )}

        <FlatList
          data={threads}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
          renderItem={({ item }) => {
            const name = item.counterpart.username ?? 'Deleted user';
            return (
              <Pressable
                style={({ pressed }) => [styles.card, item.unread && styles.cardUnread, pressed && styles.cardPressed]}
                onPress={() => router.push(`/messages/${item.id}`)}>
                <Avatar label={name} size={48} />
                <View style={styles.rowInfo}>
                  <View style={styles.rowTop}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
                      {name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatRelativeTime(item.lastMessageAt)}
                    </ThemedText>
                  </View>
                  {item.listing && (
                    <ThemedText type="small" numberOfLines={1} style={styles.listingLine}>
                      Re: {item.listing.title}
                    </ThemedText>
                  )}
                  <View style={styles.previewRow}>
                    {item.unread && <View style={styles.unreadDot} />}
                    <ThemedText
                      type="small"
                      numberOfLines={1}
                      themeColor={item.unread ? 'text' : 'textSecondary'}
                      style={styles.preview}>
                      {item.lastMessageIsMine ? 'You: ' : ''}
                      {item.lastMessageBody}
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
  error: { color: '#D64545', padding: Spacing.three },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one, padding: Spacing.six },
  emptyTitle: { marginTop: Spacing.one },
  emptySubtitle: { textAlign: 'center' },
  list: { padding: Spacing.three, paddingBottom: Spacing.six },
  // Real cards (shadow, rounded corners, own background) instead of plain
  // divided rows — matches the rest of the app's list screens (Sold/Buy
  // History, My Bids). An unread thread gets a gold left accent, same
  // color as its own unread dot below, so the whole card reads as "new"
  // at a glance before you even look at the dot.
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    ...CardShadow,
  },
  cardUnread: { borderLeftColor: Brand.gold },
  cardPressed: { opacity: 0.85 },
  rowInfo: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { flex: 1, marginRight: Spacing.two },
  listingLine: { color: Brand.navy },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Brand.gold },
});
