import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { getMessageThread, sendMessage, type ChatMessage, type MessageThreadDetail } from '@/lib/api';
import { formatRelativeTime } from '@/lib/types';

// Mobile counterpart to apps/web/components/messages/ThreadView.tsx —
// same header (counterpart name), same "About: <listing>" context banner,
// same bubble alignment rule (m.senderId === currentUserId, computed
// client-side — the server never sends a viewer-relative field), same
// optimistic send (append locally, roll the draft back on failure), same
// faster poll while a thread is actually open (4s vs the inbox list's
// 15s) — CLAUDE.md §6.15's reasoning for both intervals applies here
// unchanged, since there's still no websocket infra to replace polling
// with.
const OPEN_THREAD_POLL_MS = 4000;

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const [detail, setDetail] = useState<MessageThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Real keyboard height, applied directly as the composer's own
  // marginBottom below — not KeyboardAvoidingView (its "padding" behavior
  // was leaving the composer short of fully clearing the keyboard). The
  // SafeAreaView below already reserves `insets.bottom` worth of space for
  // the home indicator; the keyboard covers that same strip too, so
  // subtracting it out here is what keeps the composer sitting flush right
  // above the keyboard instead of floating an extra `insets.bottom` above
  // it (double-counting that space otherwise).
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    getMessageThread(id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load conversation'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      getMessageThread(id)
        .then(setDetail)
        .catch(() => {
          // Best-effort, same as the inbox list's poll — a missed refresh
          // just gets retried next interval.
        });
    }, OPEN_THREAD_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [detail?.id, detail?.messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    setDraft('');
    try {
      const msg: ChatMessage = await sendMessage(id, body);
      setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, msg] } : prev));
    } catch {
      setSendError("Message didn't send — try again.");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <ThemedText type="small">Loading…</ThemedText>
      </ThemedView>
    );
  }

  if (error || !detail) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <ThemedText type="small">{error ?? 'Conversation not found'}</ThemedText>
      </ThemedView>
    );
  }

  const name = detail.counterpart.username ?? 'Deleted user';
  const currentUserId = session?.user.id;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: name, headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {detail.listing && (
          <Pressable style={styles.listingBanner} onPress={() => router.push(`/listing/${detail.listing!.id}`)}>
            <Image source={detail.listing.imageUrl} style={styles.listingThumb} contentFit="cover" />
            <ThemedText type="small" numberOfLines={1} style={styles.listingBannerText}>
              About: <ThemedText type="small" style={styles.listingBannerTitle}>{detail.listing.title}</ThemedText>
            </ThemedText>
          </Pressable>
        )}

        <ScrollView ref={scrollRef} style={styles.messagesScroll} contentContainerStyle={styles.messages}>
          {detail.messages.map((m) => {
            const mine = m.senderId === currentUserId;
            return (
              <View key={m.id} style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <ThemedText style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                    {m.body}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary" style={styles.bubbleTime}>
                  {formatRelativeTime(m.createdAt)}
                </ThemedText>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.composer, { marginBottom: Math.max(keyboardHeight - insets.bottom, 0) }]}>
          {sendError && (
            <ThemedText type="small" style={styles.error}>
              {sendError}
            </ThemedText>
          )}
          <View style={styles.composerRow}>
            <TextInput
              style={styles.input}
              placeholder={`Message ${name}...`}
              placeholderTextColor={Colors.light.textSecondary}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <Pressable
              style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}>
              <SymbolView name="arrow.up" size={16} tintColor="#ffffff" fallback={null} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.light.background },
  listingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: Colors.light.backgroundElement,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  listingThumb: { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: Colors.light.surface },
  listingBannerText: { flex: 1, color: Colors.light.textSecondary },
  listingBannerTitle: { fontWeight: '600', color: Colors.light.text },
  messagesScroll: { flex: 1 },
  messages: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  bubbleRow: { maxWidth: '78%', gap: 2 },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleRowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.lg },
  bubbleMine: { backgroundColor: Brand.navy, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.light.backgroundElement, borderBottomLeftRadius: 4 },
  bubbleTextMine: { color: '#ffffff' },
  bubbleTextTheirs: { color: Colors.light.text },
  bubbleTime: { fontSize: 11, paddingHorizontal: 2 },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  error: { color: '#D64545', fontSize: 12 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.navy,
  },
  sendButtonDisabled: { opacity: 0.4 },
});
