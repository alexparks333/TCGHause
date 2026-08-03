import { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DevQuickSwitch } from '@/components/dev-quick-switch';
import { GoogleIcon } from '@/components/google-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Wordmark } from '@/components/wordmark';
import { Brand } from '@/constants/brand';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSession } from '@/lib/auth-context';

export default function SignInScreen() {
  const { signIn, signUp, signInWithGoogle } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function handleSubmit() {
    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);
    const { error: authError } = mode === 'sign-in' ? await signIn(email, password) : await signUp(email, password);
    setSubmitting(false);
    if (authError) setError(authError);
  }

  async function handleGoogle() {
    setError(null);
    setGoogleSubmitting(true);
    const { error: authError } = await signInWithGoogle();
    setGoogleSubmitting(false);
    if (authError) setError(authError);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View>
                <View style={styles.hero}>
                  <Wordmark size={30} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
                    {mode === 'sign-in' ? 'Sign in to browse and bid' : 'Create your account'}
                  </ThemedText>
                </View>

                <View style={styles.card}>
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor="#9AA0A6"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    value={email}
                    onChangeText={setEmail}
                  />
                  <TextInput
                    ref={passwordRef}
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#9AA0A6"
                    secureTextEntry
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                    value={password}
                    onChangeText={setPassword}
                  />

                  {error && (
                    <ThemedText type="small" style={styles.error}>
                      {error}
                    </ThemedText>
                  )}

                  <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                    onPress={handleSubmit}
                    disabled={submitting}>
                    <ThemedText type="smallBold" style={styles.primaryButtonText}>
                      {submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Sign up'}
                    </ThemedText>
                  </Pressable>

                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <ThemedText type="small" themeColor="textSecondary">
                      or
                    </ThemedText>
                    <View style={styles.dividerLine} />
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.googleButton, pressed && styles.pressed]}
                    onPress={handleGoogle}
                    disabled={googleSubmitting}>
                    <GoogleIcon />
                    <ThemedText type="smallBold" style={styles.googleButtonText}>
                      {googleSubmitting ? 'Please wait…' : 'Continue with Google'}
                    </ThemedText>
                  </Pressable>
                </View>

                <Pressable
                  style={styles.switchModeLink}
                  onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
                  <ThemedText type="link" themeColor="textSecondary">
                    {mode === 'sign-in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                  </ThemedText>
                </Pressable>

                <View style={styles.devSwitchWrap}>
                  <DevQuickSwitch />
                </View>
              </View>
            </TouchableWithoutFeedback>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four },
  hero: { alignItems: 'center', gap: Spacing.one, marginBottom: Spacing.five },
  subtitle: { marginTop: Spacing.one },
  card: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.xl,
    backgroundColor: Colors.light.surface,
    ...CardShadow,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    backgroundColor: Colors.light.background,
  },
  primaryButton: {
    backgroundColor: Brand.gold,
    borderRadius: 999,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#ffffff' },
  pressed: { opacity: 0.85 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#DADCE0' },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    backgroundColor: Colors.light.surface,
  },
  googleButtonText: { color: '#3C4043' },
  error: { color: '#D64545' },
  switchModeLink: { alignItems: 'center', marginTop: Spacing.four },
  devSwitchWrap: { marginTop: Spacing.five },
});
