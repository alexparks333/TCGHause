import { StyleSheet, Text, View } from 'react-native';

// A plain-View badge, not the trademarked multi-color "G" mark — pulling in
// react-native-svg for a pixel-exact logo would add a native module that
// isn't in the already-built dev client, forcing another EAS rebuild just
// for an icon. This is a fine stand-in for local dev/testing.
export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.letter, { fontSize: size * 0.65 }]}>G</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: '#4285F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
