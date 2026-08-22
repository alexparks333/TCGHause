import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { ORDER_OFF_PATH_LABELS, ORDER_STEPS, type OrderState } from '@/lib/types';

// The mobile counterpart to apps/web's OrderStatusPanel.tsx Timeline —
// full icon+label rows instead of transaction-bubbles.tsx's compact dots,
// for the order detail screen where there's room to show the whole
// lifecycle plainly. Same ORDER_STEPS/ORDER_OFF_PATH_LABELS source of
// truth as the compact version.
export function OrderTimeline({ state }: { state: OrderState }) {
  const offPath = ORDER_OFF_PATH_LABELS[state];
  if (offPath) {
    return (
      <ThemedText type="smallBold" style={styles.offPath}>
        {offPath}
      </ThemedText>
    );
  }

  const currentIndex = ORDER_STEPS.findIndex((s) => s.state === state);

  return (
    <View style={styles.list}>
      {ORDER_STEPS.map((step, i) => {
        const done = currentIndex >= 0 && i <= currentIndex;
        return (
          <View key={step.state} style={styles.row}>
            <SymbolView
              name={done ? 'checkmark.circle.fill' : 'circle'}
              size={18}
              tintColor={done ? '#2E9E5B' : Colors.light.backgroundSelected}
              fallback={null}
            />
            <ThemedText type="small" style={done ? styles.labelDone : styles.labelPending}>
              {step.label}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  labelDone: { fontWeight: '600' },
  labelPending: { color: Colors.light.textSecondary },
  offPath: { color: '#D64545' },
});
