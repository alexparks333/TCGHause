import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { CardShadow } from '@/constants/shadow';
import { Brand } from '@/constants/brand';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(340, SCREEN_WIDTH * 0.88);
const POLL_MS = 15000;

// Same "a small corner badge on the listing's own photo reads as 'what
// happened, on the actual card'" reasoning as apps/web/components/
// NotificationBell.tsx — kept identical (kinds, copy, colors) so the two
// apps read as the same product.
const KIND_META: Record<
  AppNotification['kind'],
  { badgeColor: string; badgeLabel: string; text: (title: string) => string }
> = {
  won: { badgeColor: Brand.success, badgeLabel: 'Won', text: (t) => `You won ${t}!` },
  bought: { badgeColor: Brand.success, badgeLabel: 'Bought', text: (t) => `You bought ${t}!` },
  sold: { badgeColor: Brand.success, badgeLabel: 'Sold', text: (t) => `Your listing sold: ${t}` },
  outbid: { badgeColor: Brand.urgent, badgeLabel: 'Outbid', text: (t) => `You've been outbid on ${t}` },
};

// Mobile counterpart to apps/web/components/NotificationBell.tsx. Web opens
// a hover-style dropdown anchored under the bell; that metaphor doesn't
// translate to touch, so this reuses AccountSidebar's slide-in-from-right
// panel instead — the app's one established pattern for "menu opened from a
// top-right header icon" (avatar -> AccountSidebar, bell -> this). Owns its
// own fetch+poll (there's no SSR here to seed initial state the way web's
// Header does), same self-contained shape as messages/index.tsx.
export function NotificationBell() {
  const router = useRouter();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const translateX = useSharedValue(PANEL_WIDTH);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const data = await getMyNotifications();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Best-effort, matches web — a missed poll just retries next interval.
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [session, refresh]);

  useEffect(() => {
    translateX.value = withTiming(open ? 0 : PANEL_WIDTH, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [open, translateX]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  async function handleOpenNotification(n: AppNotification) {
    setOpen(false);
    if (!n.readAt) {
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((p) => (p.id === n.id ? { ...p, readAt: new Date().toISOString() } : p)),
      );
      markNotificationRead(n.id).catch(() => {});
    }
    router.push(`/listing/${n.listingId}`);
  }

  async function handleMarkAllRead() {
    setUnreadCount(0);
    setNotifications((prev) => prev.map((p) => ({ ...p, readAt: p.readAt ?? new Date().toISOString() })));
    markAllNotificationsRead().catch(() => {});
  }

  if (!session) return null;

  return (
    <>
      <Pressable hitSlop={12} onPress={() => setOpen(true)} style={styles.trigger} accessibilityLabel="Notifications">
        <SymbolView name="bell" size={21} tintColor={Colors.light.text} fallback={null} />
        {unreadCount > 0 && (
          <View style={styles.triggerBadge}>
            <ThemedText style={styles.triggerBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</ThemedText>
          </View>
        )}
      </Pressable>

      <Modal transparent visible={open} animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close notifications" />
        <Animated.View style={[styles.panel, panelStyle]}>
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <View style={styles.panelHeader}>
              <ThemedText type="smallBold">Notifications</ThemedText>
              {unreadCount > 0 && (
                <Pressable onPress={handleMarkAllRead} hitSlop={8}>
                  <ThemedText type="small" style={styles.markAllRead}>
                    Mark all read
                  </ThemedText>
                </Pressable>
              )}
            </View>

            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                  No notifications yet.
                </ThemedText>
              }
              renderItem={({ item }) => {
                const meta = KIND_META[item.kind];
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.row,
                      !item.readAt && styles.rowUnread,
                      pressed && styles.rowPressed,
                    ]}
                    onPress={() => handleOpenNotification(item)}>
                    <View style={styles.thumbWrap}>
                      {item.listingImageUrl && (
                        <Image source={item.listingImageUrl} style={styles.thumb} contentFit="cover" />
                      )}
                      <View style={[styles.kindBadge, { backgroundColor: meta.badgeColor }]}>
                        <ThemedText style={styles.kindBadgeText}>{meta.badgeLabel}</ThemedText>
                      </View>
                    </View>
                    <View style={styles.rowInfo}>
                      <ThemedText type={item.readAt ? 'small' : 'smallBold'} numberOfLines={2}>
                        {meta.text(item.listingTitle)}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatRelativeTime(item.createdAt)}
                      </ThemedText>
                    </View>
                    {!item.readAt && <View style={styles.unreadDot} />}
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { padding: Spacing.one },
  triggerBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.urgent,
  },
  triggerBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700', lineHeight: 12 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: Colors.light.surface,
  },
  safe: { flex: 1 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  markAllRead: { color: Brand.navy, fontWeight: '600' },
  list: { padding: Spacing.two, paddingBottom: Spacing.six },
  empty: { padding: Spacing.six, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
    alignItems: 'flex-start',
    padding: Spacing.two,
    borderRadius: Radius.md,
  },
  rowUnread: { backgroundColor: 'rgba(15,23,41,0.03)' },
  rowPressed: { backgroundColor: Colors.light.backgroundElement },
  thumbWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.light.backgroundElement,
    overflow: 'visible',
    ...CardShadow,
  },
  thumb: { width: '100%', height: '100%', borderRadius: Radius.sm },
  kindBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  kindBadgeText: { color: '#ffffff', fontSize: 8, fontWeight: '700', lineHeight: 10 },
  rowInfo: { flex: 1, gap: 2, paddingTop: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Brand.navy, marginTop: Spacing.one },
});
