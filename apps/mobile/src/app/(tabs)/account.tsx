import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddressSection } from '@/components/account/address-section';
import { BioSection } from '@/components/account/bio-section';
import { ReviewsSection } from '@/components/account/reviews-section';
import { StarRating } from '@/components/account/star-rating';
import { UsernameSection } from '@/components/account/username-section';
import { DevQuickSwitch } from '@/components/dev-quick-switch';
import { Hero } from '@/components/hero';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { CardShadow, SoftShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import {
  getMe,
  getMyAddress,
  getSellerReviews,
  type Address,
  type ReviewSummary,
} from '@/lib/api';
import type { Me } from '@/lib/types';

// Hardcoded, not fed by any real backend — apps/api/internal/seller is a
// doc-only stub (no tier/KYC logic exists yet). Mirrors the exact same
// hardcoded placeholder apps/web/app/account/settings/page.tsx shows, for
// visual parity, not because this is real data anywhere.
const SALES_COMPLETED = 0;
const SALES_TO_NEXT_TIER = 10;

export default function AccountScreen() {
  const { session, signOut } = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [reviews, setReviews] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState({
    outbid: true,
    endingSoon: true,
    messages: true,
    orders: true,
  });

  const scrollRef = useRef<ScrollView>(null);
  const reviewsY = useRef(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      const meData = await getMe();
      setMe(meData);
      const [addr, reviewData] = await Promise.all([
        getMyAddress(),
        meData.username ? getSellerReviews(meData.username) : Promise.resolve(null),
      ]);
      setAddress(addr);
      setReviews(reviewData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    }
  }, []);

  // Keyed on the signed-in user's id — see bids.tsx for why: without this,
  // switching accounts (dev quick switch or a real sign-out/sign-in) leaves
  // this screen showing whichever account's profile it loaded first.
  useEffect(() => {
    load();
  }, [load, session?.user.id]);

  function scrollToReviews() {
    scrollRef.current?.scrollTo({ y: reviewsY.current, animated: true });
  }

  function handleReviewsLayout(e: LayoutChangeEvent) {
    reviewsY.current = e.nativeEvent.layout.y;
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <ThemedText type="title" style={styles.header}>
          Account
        </ThemedText>

        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
          <View style={styles.profileHeader}>
            <View>
              <ThemedText type="smallBold">{me?.username ?? 'No username set'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {me?.email ?? session?.user.email}
              </ThemedText>
            </View>
            {reviews && reviews.count > 0 && (
              <Pressable style={styles.ratingBubble} onPress={scrollToReviews}>
                <StarRating rating={reviews.averageRating} />
                <ThemedText type="small">
                  {reviews.averageRating.toFixed(1)} ({reviews.count})
                </ThemedText>
              </Pressable>
            )}
          </View>

          {me && <Hero tier={me.tier} />}

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Section title="Username">
            <UsernameSection username={me?.username ?? null} onSaved={(u) => setMe((m) => (m ? { ...m, username: u } : m))} />
          </Section>

          <Section title="Bio">
            <BioSection bio={me?.bio ?? null} onSaved={(b) => setMe((m) => (m ? { ...m, bio: b } : m))} />
          </Section>

          <Section title="Shipping address">
            <AddressSection address={address} onSaved={setAddress} />
          </Section>

          <Section title="Seller status">
            <ThemedText type="small" themeColor="textSecondary" style={styles.placeholderNote}>
              Not real data yet — seller tiers aren't built on the backend. Shown for visual
              parity with the website, which displays this same placeholder.
            </ThemedText>
            <ThemedText type="smallBold">Tier 1 — Probationary</ThemedText>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, (SALES_COMPLETED / SALES_TO_NEXT_TIER) * 100)}%` },
                ]}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {SALES_COMPLETED}/{SALES_TO_NEXT_TIER} sales to next tier
            </ThemedText>
          </Section>

          <Section title="Notifications">
            <ThemedText type="small" themeColor="textSecondary" style={styles.placeholderNote}>
              Not wired to anything yet — same as the website's version of this section.
            </ThemedText>
            {(
              [
                ['outbid', 'Outbid alerts'],
                ['endingSoon', 'Auction ending soon'],
                ['messages', 'New messages'],
                ['orders', 'Order updates'],
              ] as const
            ).map(([key, label]) => (
              <Pressable
                key={key}
                style={styles.checkboxRow}
                onPress={() => setNotifications((n) => ({ ...n, [key]: !n[key] }))}>
                <View style={[styles.checkbox, notifications[key] && styles.checkboxChecked]} />
                <ThemedText type="small">{label}</ThemedText>
              </Pressable>
            ))}
          </Section>

          <View onLayout={handleReviewsLayout}>
            <Section title="Reviews">
              <ReviewsSection reviews={reviews?.reviews ?? []} />
            </Section>
          </View>

          <Pressable style={styles.signOutButton} onPress={signOut}>
            <ThemedText type="smallBold">Sign out</ThemedText>
          </Pressable>

          <View style={styles.devSwitchWrap}>
            <DevQuickSwitch />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { fontSize: 28, lineHeight: 34, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.four },
  profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ratingBubble: {
    alignItems: 'flex-end',
    gap: 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.surface,
    ...SoftShadow,
  },
  error: { color: '#D64545' },
  section: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  sectionTitle: { color: Brand.navy, fontSize: 16 },
  placeholderNote: { fontStyle: 'italic' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light.backgroundElement,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Brand.gold },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
  },
  checkboxChecked: { backgroundColor: Brand.navy, borderColor: Brand.navy },
  signOutButton: {
    borderRadius: Radius.full,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: Colors.light.surface,
    ...SoftShadow,
  },
  devSwitchWrap: {},
});
