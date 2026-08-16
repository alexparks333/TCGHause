import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';

// Mirrors apps/web's Avatar.tsx exactly: a real photo (Google's avatar_url
// for a Google sign-in) when there is one, otherwise a navy circle with the
// first two letters of the display name — never a generic silhouette icon.
export function Avatar({ src, label, size = 32 }: { src?: string | null; label: string; size?: number }) {
  if (src) {
    return (
      <Image
        source={src}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }

  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <ThemedText style={{ color: '#ffffff', fontWeight: '700', fontSize: size * 0.4 }}>
        {label.slice(0, 2).toUpperCase()}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: Brand.navy, alignItems: 'center', justifyContent: 'center' },
});
