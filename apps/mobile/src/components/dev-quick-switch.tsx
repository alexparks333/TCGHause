import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';
import { DEV_ACCOUNTS } from '@/lib/dev-accounts';

// Renders nothing at all outside development or when no DEV_ACCOUNT_* env
// vars are set — belt-and-suspenders with DEV_ACCOUNTS already being empty
// in those cases (src/lib/dev-accounts.ts).
export function DevQuickSwitch() {
  const { session, signIn } = useSession();
  const [switching, setSwitching] = useState<string | null>(null);

  if (!__DEV__ || DEV_ACCOUNTS.length === 0) return null;

  async function switchTo(email: string, password: string, key: string) {
    setSwitching(key);
    await signIn(email, password);
    setSwitching(null);
  }

  return (
    <View style={styles.panel}>
      <ThemedText type="small" themeColor="textSecondary">
        Dev quick switch
        {session?.user.email ? ` — signed in as ${session.user.email}` : ''}
      </ThemedText>
      <View style={styles.row}>
        {DEV_ACCOUNTS.map((account) => {
          const active = session?.user.email === account.email;
          return (
            <Pressable
              key={account.key}
              style={[styles.pill, active && styles.pillActive]}
              disabled={switching !== null}
              onPress={() => switchTo(account.email, account.password, account.key)}>
              <ThemedText type="small" style={active ? styles.pillTextActive : undefined}>
                {switching === account.key ? '…' : account.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.backgroundElement,
  },
  row: { flexDirection: 'row', gap: Spacing.two },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
  },
  pillActive: {
    backgroundColor: Brand.navy,
    borderColor: Brand.navy,
  },
  pillTextActive: { color: '#ffffff' },
});
