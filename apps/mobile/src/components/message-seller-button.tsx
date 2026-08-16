import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Colors, Radius, Spacing } from '@/constants/theme';

// Mobile counterpart to apps/web/components/messages/MessageSellerButton.tsx
// — a trigger only. Used to open an in-place Modal with its own compose
// UI, but no combination of KeyboardAvoidingView / manual keyboard-height
// padding kept the input visible above the keyboard inside that Modal's
// own separate native layer. Navigating to a real screen
// (app/messages/new.tsx) that reuses the exact same plain, non-Modal
// composer shape as the already-working thread view (messages/[id].tsx)
// sidesteps the problem entirely instead of continuing to fight it.
// Reused from both listing/[id].tsx (with listingId set, so the thread
// carries "About: <listing>" context) and seller/[username].tsx (without
// one). Callers are responsible for only rendering this when there's a
// signed-in viewer who isn't messaging themselves — same as web's callers
// guard on isLoggedIn/not-own-listing.
export function MessageSellerButton({
  recipientId,
  recipientLabel,
  listingId,
}: {
  recipientId: string;
  recipientLabel: string;
  listingId?: string;
}) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      onPress={() =>
        router.push({
          pathname: '/messages/new',
          params: { recipientId, recipientLabel, ...(listingId ? { listingId } : {}) },
        })
      }>
      <ThemedText type="smallBold" style={styles.buttonText}>
        Message Seller
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Brand.navy,
  },
  buttonPressed: { backgroundColor: Colors.light.backgroundElement },
  buttonText: { color: Brand.navy },
});
