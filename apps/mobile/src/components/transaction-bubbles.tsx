import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Colors, Spacing } from '@/constants/theme';
import { ORDER_OFF_PATH_LABELS, ORDER_STEPS, type OrderState } from '@/lib/types';

// Mirrors apps/web's TransactionBubbles.tsx exactly — compact connected
// dots instead of the full order-status screen's icon+label rows, so a
// whole list of transactions can each show progress at a glance (csfloat's
// trade-history bubbles are the reference point). Same ORDER_STEPS/
// ORDER_OFF_PATH_LABELS source of truth as the full timeline on
// app/order/[id].tsx.
export function TransactionBubbles({ state }: { state: OrderState }) {
  const offPath = ORDER_OFF_PATH_LABELS[state];
  if (offPath) {
    return (
      <ThemedText type="small" style={styles.offPath}>
        {offPath}
      </ThemedText>
    );
  }

  const currentIndex = ORDER_STEPS.findIndex((s) => s.state === state);

  return (
    <View style={styles.row}>
      {ORDER_STEPS.map((step, i) => {
        const done = currentIndex >= 0 && i <= currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <View key={step.state} style={styles.stepWrap}>
            <View style={[styles.dot, done && (isCurrent ? styles.dotCurrent : styles.dotDone)]} />
            {i < ORDER_STEPS.length - 1 && <View style={[styles.line, done && styles.lineDone]} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  stepWrap: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.light.backgroundElement,
  },
  dotDone: { backgroundColor: '#2E9E5B' },
  dotCurrent: { backgroundColor: Brand.gold },
  line: { width: Spacing.three, height: 2, backgroundColor: Colors.light.backgroundElement },
  lineDone: { backgroundColor: '#2E9E5B' },
  offPath: { color: '#D64545', fontWeight: '600' },
});
