import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { DevQuickSwitch } from '@/components/dev-quick-switch';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getMyThreads } from '@/lib/api';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(320, SCREEN_WIDTH * 0.82);

// Mirrors apps/web's AccountMenu.tsx ACTIVITY_LINKS exactly — same labels,
// same order — so the sidebar reads as the same product as the website's
// account dropdown. Every one of these now has a real mobile screen except
// Account Settings' siblings that were never in scope here. Watchlist
// itself lives under the tab navigator (app/(tabs)/watchlist.tsx) — the
// group segment doesn't appear in the URL, so this still just pushes
// '/watchlist'. Selling, Buy History, and Messages are deliberately NOT
// bottom-tab screens (unlike Watchlist) — only reachable from here, same
// as Withdraw/Sold History.
type SidebarRoute =
  | '/bids'
  | '/account'
  | '/withdraw'
  | '/sold-history'
  | '/buy-history'
  | '/watchlist'
  | '/selling'
  | '/messages';
const ACTIVITY_LINKS: { label: string; route: SidebarRoute | null }[] = [
  { label: 'Watchlist', route: '/watchlist' },
  { label: 'Selling', route: '/selling' },
  { label: 'Withdraw', route: '/withdraw' },
  { label: 'Bids/Offers', route: '/bids' },
  { label: 'Sold History', route: '/sold-history' },
  { label: 'Buy History', route: '/buy-history' },
  { label: 'Messages', route: '/messages' },
];

export function AccountSidebar({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { session, signOut } = useSession();
  const translateX = useSharedValue(PANEL_WIDTH);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  useEffect(() => {
    translateX.value = withTiming(visible ? 0 : PANEL_WIDTH, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, translateX]);

  // Mirrors apps/web's Header/AccountMenu badge — a fresh, uncached fetch
  // each time the sidebar opens rather than something kept live in the
  // background, same "cheap enough, no reason to poll a closed menu"
  // tradeoff web accepts for the same badge (CLAUDE.md §6.15).
  useEffect(() => {
    if (!visible || !session) return;
    getMyThreads()
      .then((data) => setUnreadMessageCount(data.unreadCount))
      .catch(() => {});
  }, [visible, session]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const user = session?.user;
  const fullName = user?.user_metadata?.full_name as string | undefined;
  const email = user?.email ?? '';
  const displayName = fullName || email;
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  function go(route: SidebarRoute | null, label: string) {
    onClose();
    if (route) {
      router.push(route);
    } else {
      Alert.alert(label, `${label} is coming soon — not built yet.`);
    }
  }

  function handleSignOut() {
    onClose();
    signOut();
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View style={[styles.panel, panelStyle]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.profileRow}>
              <Avatar src={avatarUrl} label={displayName || 'U'} size={44} />
              <View style={styles.profileText}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {displayName || 'Signed in'}
                </ThemedText>
                {email && email !== displayName && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {email}
                  </ThemedText>
                )}
              </View>
            </View>

            {ACTIVITY_LINKS.map((link) => (
              <Pressable
                key={link.label}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                onPress={() => go(link.route, link.label)}>
                <View style={styles.itemRow}>
                  <ThemedText type="small">{link.label}</ThemedText>
                  {link.label === 'Messages' && unreadMessageCount > 0 && (
                    <View style={styles.badge}>
                      <ThemedText style={styles.badgeText}>{unreadMessageCount}</ThemedText>
                    </View>
                  )}
                </View>
              </Pressable>
            ))}

            <View style={styles.divider} />

            <Pressable
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={() => go('/account', 'Account Settings')}>
              <ThemedText type="small">Account Settings</ThemedText>
            </Pressable>

            <View style={styles.devSwitchWrap}>
              <DevQuickSwitch />
            </View>

            <View style={styles.divider} />

            <Pressable
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={handleSignOut}>
              <ThemedText type="small" style={styles.signOut}>
                Sign out
              </ThemedText>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  scroll: { padding: Spacing.three, gap: Spacing.one },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
  },
  profileText: { flex: 1 },
  item: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.gold,
  },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  itemPressed: { backgroundColor: Colors.light.backgroundElement },
  devSwitchWrap: { marginTop: Spacing.two, paddingHorizontal: Spacing.two },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.light.border,
    marginVertical: Spacing.two,
  },
  signOut: { color: '#D64545' },
});
