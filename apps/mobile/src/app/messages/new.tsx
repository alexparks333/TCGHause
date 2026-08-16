import { SymbolView } from 'expo-symbols';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand } from '@/constants/brand';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { startMessageThread } from '@/lib/api';

// Full-screen compose flow for the FIRST message of a new-or-reopened
// conversation, reached from MessageSellerButton. Expo Router resolves
// this static route ahead of the dynamic messages/[id] route for the
// literal path /messages/new, same as Next.js's own file-based routing
// precedence.
export default function NewMessageScreen() {
  const { recipientId, recipientLabel, listingId } = useLocalSearchParams<{
    recipientId: string;
    recipientLabel: string;
    listingId?: string;
  }>();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();

  const name = recipientLabel || 'Seller';

  // Real keyboard height, applied directly as the composer's own
  // marginBottom below — not KeyboardAvoidingView (its "padding" behavior
  // was leaving the composer short of fully clearing the keyboard). The
  // SafeAreaView below already reserves `insets.bottom` worth of space for
  // the home indicator; the keyboard covers that same strip too, so
  // subtracting it out here is what keeps the composer sitting flush right
  // above the keyboard instead of floating an extra `insets.bottom` above
  // it — same fix as messages/[id].tsx.
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

  async function handleSend() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const detail = await startMessageThread(recipientId, trimmed, listingId || undefined);
      // replace, not push — the empty compose screen shouldn't sit in the
      // back-stack behind the now-real conversation it just created.
      router.replace(`/messages/${detail.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
      setSending(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: name, headerBackTitle: 'Back' }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.hint}>
          <ThemedText type="small" themeColor="textSecondary">
            Start a conversation with {name}.
          </ThemedText>
        </View>

        <View style={styles.spacer} />

        <View style={[styles.composer, { marginBottom: Math.max(keyboardHeight - insets.bottom, 0) }]}>
          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}
          <View style={styles.composerRow}>
            <TextInput
              style={styles.input}
              placeholder={`Message ${name}...`}
              placeholderTextColor={Colors.light.textSecondary}
              value={body}
              onChangeText={setBody}
              multiline
              autoFocus
            />
            <Pressable
              style={[styles.sendButton, (!body.trim() || sending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!body.trim() || sending}>
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
  hint: { padding: Spacing.four, alignItems: 'center' },
  spacer: { flex: 1 },
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
