import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  ApiError,
  acceptPartialRefund,
  addClaimEvidence,
  addClaimMessage,
  appealClaim,
  escalateClaim,
  getClaimForListing,
  openClaim,
  proposePartialRefund,
  resolveClaimByAgreement,
} from '@/lib/api';
import { uploadOrderEvidence } from '@/lib/storage';
import { formatPrice, type ClaimDetail, type ClaimReasonCode } from '@/lib/types';

const REASON_LABELS: Record<ClaimReasonCode, string> = {
  not_as_described: "Item wasn't as described",
  not_received_no_tracking: 'Never arrived (no tracking)',
  not_received_tracking_delivered: 'Never arrived (tracking shows delivered)',
  payment_fraud: "I didn't make this purchase",
  buyers_remorse: 'Changed my mind',
  transit_damage: 'Arrived damaged',
};

const STATE_LABELS: Record<string, string> = {
  opened: 'Just opened',
  negotiating: 'In discussion',
  escalated: 'Escalated',
  auto_adjudicated: 'Under review',
  human_review: 'Under review',
  decided: 'Decided',
  appealed: 'Appeal under review',
  closed: 'Closed',
};

// The mobile counterpart to apps/web's ClaimPanel.tsx — same ladder
// (design doc v2 §9): file a claim, negotiate, propose/accept a partial
// refund, escalate, see/appeal a decision. Only shows up when a claim
// genuinely exists, or when the order is in its claim window and the
// viewer is the buyer (the only party design doc v2 §9.3's reason codes
// let file one) — mirrors ClaimPanel's own gating exactly.
export function ClaimPanel({
  listingId,
  orderId,
  orderState,
  viewerIsSeller,
}: {
  listingId: string;
  orderId: string;
  orderState: string;
  viewerIsSeller: boolean;
}) {
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      setDetail(await getClaimForListing(listingId));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        // Best-effort — a load failure just leaves the panel showing
        // whatever it already had (or nothing, on first load).
      }
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  if (loading) return null;

  if (!detail) {
    if (orderState !== 'claim_window' || viewerIsSeller) return null;
    return <FileClaimForm orderId={orderId} onFiled={refresh} />;
  }

  return <ClaimThread detail={detail} onChange={refresh} />;
}

function FileClaimForm({ orderId, onFiled }: { orderId: string; onFiled: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClaimReasonCode>('not_as_described');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <Pressable style={styles.linkButton} onPress={() => setOpen(true)}>
        <SymbolView name="exclamationmark.triangle" size={14} tintColor="#D64545" fallback={null} />
        <ThemedText type="small" style={styles.urgentLink}>
          Something wrong with this order?
        </ThemedText>
      </Pressable>
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      await openClaim(orderId, reason, body);
      onFiled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">File a claim</ThemedText>
      <View style={styles.reasonList}>
        {(Object.entries(REASON_LABELS) as [ClaimReasonCode, string][]).map(([value, label]) => (
          <Pressable
            key={value}
            style={[styles.reasonOption, reason === value && styles.reasonOptionActive]}
            onPress={() => setReason(value)}>
            <ThemedText type="small" style={reason === value ? styles.reasonLabelActive : undefined}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="What happened?"
        placeholderTextColor={Colors.light.textSecondary}
        multiline
        style={styles.input}
      />
      <View style={styles.buttonRow}>
        <Pressable style={styles.urgentButton} disabled={submitting} onPress={handleSubmit}>
          <ThemedText type="smallBold" style={styles.buttonLabelLight}>
            Submit claim
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => setOpen(false)}>
          <ThemedText type="small" themeColor="textSecondary">
            Cancel
          </ThemedText>
        </Pressable>
      </View>
      {error !== '' && (
        <ThemedText type="small" style={styles.errorText}>
          {error}
        </ThemedText>
      )}
    </View>
  );
}

function ClaimThread({ detail, onChange }: { detail: ClaimDetail; onChange: () => void }) {
  const { claim, events } = detail;
  const [message, setMessage] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAttachPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo library access needed', 'Enable photo access in Settings to attach evidence.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    await run(async () => {
      const url = await uploadOrderEvidence(claim.orderId, result.assets[0].uri);
      await addClaimEvidence(claim.id, url);
    });
  }

  const latestOffer = [...events].reverse().find((e) => e.kind === 'partial_refund_offer');
  const negotiating = claim.state === 'negotiating';

  return (
    <View style={styles.section}>
      <View style={styles.claimHeader}>
        <SymbolView name="exclamationmark.bubble" size={16} tintColor="#D64545" fallback={null} />
        <ThemedText type="smallBold">Claim — {REASON_LABELS[claim.reasonCode]}</ThemedText>
      </View>
      <View style={styles.stateBadge}>
        <ThemedText type="small">{STATE_LABELS[claim.state] ?? claim.state}</ThemedText>
      </View>

      {claim.resolution && (
        <ThemedText type="small">
          Resolution: {claim.resolution.replace(/_/g, ' ')}
          {claim.refundCents ? ` — ${formatPrice(claim.refundCents)}` : ''}
        </ThemedText>
      )}

      <ScrollView style={styles.eventList} nestedScrollEnabled>
        {events.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            No messages yet.
          </ThemedText>
        )}
        {events.map((e) => (
          <View key={e.id} style={styles.eventRow}>
            {e.kind === 'message' && <ThemedText type="small">{e.body}</ThemedText>}
            {e.kind === 'evidence' && (
              <ThemedText type="small" style={styles.linkText}>
                Evidence photo attached
              </ThemedText>
            )}
            {e.kind === 'partial_refund_offer' && (
              <ThemedText type="smallBold">
                Partial refund offered: {formatPrice(e.amountCents ?? 0)}
              </ThemedText>
            )}
            {(e.kind === 'decision' || e.kind === 'appeal' || e.kind === 'escalation') && (
              <ThemedText type="small" style={styles.italic}>
                {e.body}
              </ThemedText>
            )}
          </View>
        ))}
      </ScrollView>

      {negotiating && (
        <>
          <View style={styles.messageRow}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Send a message"
              placeholderTextColor={Colors.light.textSecondary}
              style={[styles.input, styles.messageInput]}
            />
            <Pressable
              style={styles.sendButton}
              disabled={busy || !message}
              onPress={() =>
                run(async () => {
                  await addClaimMessage(claim.id, message);
                  setMessage('');
                })
              }>
              <SymbolView name="paperplane.fill" size={14} tintColor="#ffffff" fallback={null} />
            </Pressable>
          </View>

          <Pressable onPress={handleAttachPhoto} disabled={busy}>
            <ThemedText type="small" style={styles.linkText}>
              Attach a photo
            </ThemedText>
          </Pressable>

          {latestOffer ? (
            <Pressable
              style={styles.successButton}
              disabled={busy}
              onPress={() => run(() => acceptPartialRefund(claim.id))}>
              <ThemedText type="smallBold" style={styles.buttonLabelLight}>
                Accept {formatPrice(latestOffer.amountCents ?? 0)} partial refund
              </ThemedText>
            </Pressable>
          ) : (
            <View style={styles.messageRow}>
              <TextInput
                value={offerAmount}
                onChangeText={setOfferAmount}
                placeholder="Refund amount, e.g. 5.00"
                placeholderTextColor={Colors.light.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, styles.messageInput]}
              />
              <Pressable
                style={styles.outlineButton}
                disabled={busy || !offerAmount}
                onPress={() =>
                  run(async () => {
                    const cents = Math.round(parseFloat(offerAmount) * 100);
                    await proposePartialRefund(claim.id, cents);
                    setOfferAmount('');
                  })
                }>
                <ThemedText type="small">Propose refund</ThemedText>
              </Pressable>
            </View>
          )}

          <View style={styles.buttonRow}>
            <Pressable disabled={busy} onPress={() => run(() => resolveClaimByAgreement(claim.id))}>
              <ThemedText type="small" style={styles.successLink}>
                Mark resolved, no refund
              </ThemedText>
            </Pressable>
            <Pressable disabled={busy} onPress={() => run(() => escalateClaim(claim.id))}>
              <ThemedText type="small" style={styles.urgentLink}>
                Escalate this claim
              </ThemedText>
            </Pressable>
          </View>
        </>
      )}

      {claim.state === 'decided' && (
        <Pressable disabled={busy} onPress={() => run(() => appealClaim(claim.id, 'Requesting a second review.'))}>
          <ThemedText type="small" style={styles.linkText}>
            Appeal this decision
          </ThemedText>
        </Pressable>
      )}

      {busy && <ActivityIndicator />}
      {error !== '' && (
        <ThemedText type="small" style={styles.errorText}>
          {error}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  urgentLink: { color: '#D64545', fontWeight: '600' },
  successLink: { color: '#2E9E5B', fontWeight: '600' },
  linkText: { color: Brand.navy, fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  reasonList: { gap: Spacing.one },
  reasonOption: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.backgroundElement,
  },
  reasonOptionActive: { backgroundColor: Brand.navy },
  reasonLabelActive: { color: '#ffffff' },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    padding: Spacing.two,
    fontSize: 14,
    color: Colors.light.text,
  },
  messageInput: { flex: 1, minHeight: 0 },
  messageRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.navy,
  },
  buttonRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center', flexWrap: 'wrap' },
  urgentButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    backgroundColor: '#D64545',
  },
  successButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.full,
    backgroundColor: '#2E9E5B',
  },
  outlineButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
  },
  buttonLabelLight: { color: '#ffffff' },
  claimHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  stateBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.backgroundElement,
  },
  eventList: { maxHeight: 180 },
  eventRow: { paddingVertical: Spacing.one },
  errorText: { color: '#D64545' },
});
