import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScanPhotoSlot } from '@/components/scan-photo-slot';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { createScan, getScan, type CaptureContext, type ScanResponse } from '@/lib/cardvision-api';
import { useSession } from '@/lib/auth-context';

const CONTEXTS: { value: CaptureContext; label: string }[] = [
  { value: 'listing', label: 'Listing' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'manual', label: 'Manual' },
];

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

export default function ScanScreen() {
  const { session } = useSession();
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);
  const [context, setContext] = useState<CaptureContext>('listing');
  const [submitting, setSubmitting] = useState(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function handleSubmit() {
    if (!frontUri || !backUri || !session) return;
    setError(null);
    setSubmitting(true);
    setScan(null);
    try {
      const created = await createScan({
        frontUri,
        backUri,
        captureContext: context,
        uploaderRef: session.user.id,
      });
      setScan(created);
      pollUntilProcessed(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit scan');
    } finally {
      setSubmitting(false);
    }
  }

  function pollUntilProcessed(scanId: string) {
    const startedAt = Date.now();
    pollTimer.current = setInterval(async () => {
      try {
        const updated = await getScan(scanId);
        setScan(updated);
        if (updated.status !== 'pending' || Date.now() - startedAt > POLL_TIMEOUT_MS) {
          if (pollTimer.current) clearInterval(pollTimer.current);
        }
      } catch {
        if (pollTimer.current) clearInterval(pollTimer.current);
      }
    }, POLL_INTERVAL_MS);
  }

  function reset() {
    setFrontUri(null);
    setBackUri(null);
    setScan(null);
    setError(null);
  }

  const canSubmit = frontUri && backUri && !submitting;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title" style={styles.header}>
            Scan a Card
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subheader}>
            CardVision — photo-matched, not authenticated. Standalone test build.
          </ThemedText>

          <View style={styles.photoRow}>
            <ScanPhotoSlot
              label="Front"
              hint="Straight-on, good lighting"
              uri={frontUri}
              onPicked={setFrontUri}
              onRemoved={() => setFrontUri(null)}
            />
            <ScanPhotoSlot
              label="Back"
              hint="Show the full back"
              uri={backUri}
              onPicked={setBackUri}
              onRemoved={() => setBackUri(null)}
            />
          </View>

          <View style={styles.contextRow}>
            {CONTEXTS.map((c) => (
              <Pressable
                key={c.value}
                style={[styles.contextPill, context === c.value && styles.contextPillActive]}
                onPress={() => setContext(c.value)}>
                <ThemedText type="small" style={context === c.value ? styles.contextLabelActive : undefined}>
                  {c.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}>
            <ThemedText type="smallBold" style={styles.submitButtonText}>
              {submitting ? 'Uploading…' : 'Submit Scan'}
            </ThemedText>
          </Pressable>

          {scan && (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <ThemedText type="smallBold">Scan {scan.id.slice(0, 8)}</ThemedText>
                <Pressable onPress={reset}>
                  <ThemedText type="link" style={styles.resetLink}>
                    New scan
                  </ThemedText>
                </Pressable>
              </View>
              <ResultRow label="Status" value={scan.status} />
              <ResultRow label="Quality tier" value={scan.qualityTier ?? '—'} />
              {scan.physicalCardId && (
                <ResultRow label="Physical card" value={scan.physicalCardId.slice(0, 8)} />
              )}
              {scan.status === 'pending' && (
                <ThemedText type="small" themeColor="textSecondary">
                  Processing (feature extraction + identity resolution running async)…
                </ThemedText>
              )}
              {scan.qualityDetail && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.jsonBlock}>
                  {JSON.stringify(scan.qualityDetail, null, 2)}
                </ThemedText>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  header: { fontSize: 28, lineHeight: 34 },
  subheader: { marginTop: -Spacing.two, fontStyle: 'italic' },
  photoRow: { flexDirection: 'row', gap: Spacing.three },
  contextRow: { flexDirection: 'row', gap: Spacing.two },
  contextPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  contextPillActive: { backgroundColor: Brand.navy, shadowOpacity: 0, elevation: 0 },
  contextLabelActive: { color: '#ffffff', fontWeight: '600' },
  error: { color: '#D64545' },
  submitButton: {
    backgroundColor: Brand.gold,
    borderRadius: Radius.full,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: '#ffffff' },
  resultCard: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resetLink: { color: Brand.navy },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between' },
  jsonBlock: { fontFamily: 'monospace', fontSize: 11 },
});
