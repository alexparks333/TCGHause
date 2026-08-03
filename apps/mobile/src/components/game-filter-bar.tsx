import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { SoftShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { GAMES, type Game } from '@/lib/types';

export function GameFilterBar({
  activeGame,
  onSelect,
}: {
  activeGame: Game | null;
  onSelect: (game: Game | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      style={styles.scrollView}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      <Pill label="All" selected={activeGame === null} onPress={() => onSelect(null)} />
      {GAMES.map((game) => (
        <Pill key={game} label={game} selected={activeGame === game} onPress={() => onSelect(game)} />
      ))}
    </ScrollView>
  );
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.pill, selected && styles.pillSelected]} onPress={onPress}>
      <ThemedText type="small" style={selected ? styles.labelSelected : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flexGrow: 0,
    flexShrink: 0,
    height: 56,
  },
  row: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    backgroundColor: Colors.light.surface,
    ...SoftShadow,
  },
  pillSelected: {
    backgroundColor: Brand.navy,
    shadowOpacity: 0,
    elevation: 0,
  },
  labelSelected: { color: '#ffffff', fontWeight: '600' },
});
