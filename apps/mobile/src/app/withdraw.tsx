import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  createSellerOnboardingLink,
  getPayoutSummary,
  getSellerConnectStatus,
  triggerInstantPayout,
  triggerStandardPayout,
  type PayoutSummary,
  type SellerConnectStatus,
} from '@/lib/api';
import { formatPrice } from '@/lib/types';

// Mirrors apps/web/app/account/withdraw exactly (CLAUDE.md's Withdraw page
// section): same gate (nothing to withdraw from without Connect onboarding
// complete — WithdrawPanel there, SellerPayoutsSetup here), same wallet
// bubble + two-button layout, same payout history list. See lib/api.ts's
// createSellerOnboardingLink doc comment for the one real difference: the
// onboarding link opens the system browser and returns to the WEB app, not
// back into this app, since no mobile deep-link return path exists yet.
export default function WithdrawScreen() {
  const [status, setStatus] = useState<SellerConnectStatus | null>(null);
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [busy, setBusy] = useState<'standard' | 'instant' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const s = await getSellerConnectStatus();
      setStatus(s);
      if (s.chargesEnabled) {
        setSummary(await getPayoutSummary());
      } else {
        setSummary(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payout status');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleSetUp() {
    setSettingUp(true);
    setError('');
    try {
      const { url } = await createSellerOnboardingLink();
      await Linking.openURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSettingUp(false);
    }
  }

  async function handleWithdraw(kind: 'standard' | 'instant') {
    setBusy(kind);
    setError('');
    setMessage('');
    try {
      const { triggered } = kind === 'standard' ? await triggerStandardPayout() : await triggerInstantPayout();
      setMessage(
        triggered
          ? kind === 'standard'
            ? 'Transfer started — arrives in 1-2 business days.'
            : 'Instant transfer sent — should land within about 30 minutes.'
          : 'Nothing available to withdraw right now.',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || (summary?.availableCents ?? 0) <= 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            Your available balance, what&rsquo;s still on hold, and your payout history.
          </ThemedText>

          {error && (
            <ThemedText type="small" style={styles.errorText}>
              {error}
            </ThemedText>
          )}

          {loading ? null : status && !status.chargesEnabled ? (
            <View style={styles.setupCard}>
              <ThemedText type="smallBold">Set up payouts to withdraw</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.setupBody}>
                {status.hasAccount
                  ? 'Almost there — Stripe still needs a bit more information before you can get paid out.'
                  : "Verify your identity with Stripe so we know where to send your sale proceeds. Takes a couple of minutes."}
              </ThemedText>
              <Pressable
                style={({ pressed }) => [styles.goldButton, pressed && styles.pressed]}
                disabled={settingUp}
                onPress={handleSetUp}>
                <ThemedText type="smallBold" style={styles.goldButtonText}>
                  {settingUp ? 'Opening…' : status.hasAccount ? 'Finish setup' : 'Set up payouts'}
                </ThemedText>
                <SymbolView name="arrow.up.forward.square" size={14} tintColor="#ffffff" fallback={null} />
              </Pressable>
            </View>
          ) : summary ? (
            <>
              <View style={styles.balanceCard}>
                <View style={styles.balanceIcon}>
                  <SymbolView name="wallet.pass.fill" size={26} tintColor={Brand.gold} fallback={null} />
                </View>
                <View style={styles.balanceRow}>
                  <ThemedText style={styles.balanceAmount}>{formatPrice(summary.availableCents)}</ThemedText>
                  {summary.pendingCents > 0 && (
                    <ThemedText style={styles.balancePending}>+{formatPrice(summary.pendingCents)}</ThemedText>
                  )}
                </View>
                <ThemedText type="small" themeColor="textSecondary" style={styles.balanceCaption}>
                  Available to withdraw
                  {summary.pendingCents > 0
                    ? ' — the greyed-out amount is from sales still in progress and isn’t withdrawable yet.'
                    : ''}
                </ThemedText>
              </View>

              <View style={styles.buttonRow}>
                <View style={styles.buttonCol}>
                  <Pressable
                    style={({ pressed }) => [styles.outlineButton, (pressed || disabled) && styles.pressed]}
                    disabled={disabled}
                    onPress={() => handleWithdraw('standard')}>
                    <SymbolView name="building.columns.fill" size={14} tintColor={Colors.light.text} fallback={null} />
                    <ThemedText type="smallBold">{busy === 'standard' ? 'Sending…' : 'Standard Transfer'}</ThemedText>
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.buttonCaption}>
                    Free — 1-2 business days
                  </ThemedText>
                </View>
                <View style={styles.buttonCol}>
                  <Pressable
                    style={({ pressed }) => [styles.goldButton, (pressed || disabled) && styles.pressed]}
                    disabled={disabled}
                    onPress={() => handleWithdraw('instant')}>
                    <SymbolView name="bolt.fill" size={14} tintColor="#ffffff" fallback={null} />
                    <ThemedText type="smallBold" style={styles.goldButtonText}>
                      {busy === 'instant' ? 'Sending…' : 'Instant Transfer'}
                    </ThemedText>
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.buttonCaption}>
                    2% fee — ~30 minutes
                  </ThemedText>
                </View>
              </View>

              {message && <ThemedText type="small" style={styles.successText}>{message}</ThemedText>}

              <View style={styles.historyCard}>
                <ThemedText type="smallBold">Payout history</ThemedText>
                {summary.recent.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.historyEmpty}>
                    No payouts yet.
                  </ThemedText>
                ) : (
                  summary.recent.map((p, i) => (
                    <View key={p.id} style={[styles.historyRow, i > 0 && styles.historyRowBorder]}>
                      <View style={styles.historyLeft}>
                        {(p.status === 'pending' || p.status === 'in_transit') && (
                          <SymbolView name="clock.fill" size={12} tintColor={Colors.light.textSecondary} fallback={null} />
                        )}
                        <ThemedText type="small" themeColor="textSecondary">
                          {new Date(p.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                          {' · '}
                          {p.kind}
                          {' · '}
                        </ThemedText>
                        <ThemedText
                          type="small"
                          style={
                            p.status === 'failed'
                              ? styles.statusFailed
                              : p.status === 'paid'
                                ? styles.statusPaid
                                : { color: Colors.light.textSecondary }
                          }>
                          {p.status === 'in_transit' ? 'on its way' : p.status}
                        </ThemedText>
                      </View>
                      <ThemedText type="smallBold">{formatPrice(p.amountCents)}</ThemedText>
                    </View>
                  ))
                )}
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  subtitle: { textAlign: 'center' },
  errorText: { color: '#D64545', textAlign: 'center' },
  successText: { color: '#1a7f37', textAlign: 'center' },
  setupCard: {
    padding: Spacing.four,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    gap: Spacing.two,
    ...CardShadow,
  },
  setupBody: {},
  goldButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.full,
    backgroundColor: Brand.gold,
  },
  goldButtonText: { color: '#ffffff' },
  pressed: { opacity: 0.75 },
  balanceCard: {
    alignItems: 'center',
    padding: Spacing.five,
    borderRadius: Radius.xl,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  balanceIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(184,134,11,0.1)',
    marginBottom: Spacing.two,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  balanceAmount: { fontSize: 36, lineHeight: 43, fontWeight: '700', color: Colors.light.text },
  balancePending: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: Colors.light.textSecondary },
  balanceCaption: { marginTop: Spacing.one, textAlign: 'center' },
  buttonRow: { flexDirection: 'row', gap: Spacing.three },
  buttonCol: { flex: 1, alignItems: 'center', gap: Spacing.one },
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    width: '100%',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
  },
  buttonCaption: { textAlign: 'center' },
  historyCard: {
    padding: Spacing.four,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    gap: Spacing.one,
    ...CardShadow,
  },
  historyEmpty: { marginTop: Spacing.one },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two + 2,
  },
  historyRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.light.border },
  historyLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  statusFailed: { color: '#D64545', fontWeight: '600' },
  statusPaid: { color: '#1a7f37', fontWeight: '600' },
});
