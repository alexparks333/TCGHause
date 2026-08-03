import { StyleSheet, Text } from 'react-native';

import { Brand } from '@/constants/brand';

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <Text style={[styles.text, { fontSize: size }]}>
      AuctionHous<Text style={styles.accent}> TCG</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    fontWeight: '800',
    letterSpacing: -0.3,
    color: Brand.navy,
  },
  accent: {
    color: Brand.gold,
  },
});
