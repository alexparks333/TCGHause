import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Colors, Spacing } from '@/constants/theme';
import { checkUsernameAvailable, setUsername } from '@/lib/api';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function UsernameSection({
  username,
  onSaved,
}: {
  username: string | null;
  onSaved: (username: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(username ?? '');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editing) return;
    if (!USERNAME_RE.test(value) || value === username) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setAvailable(await checkUsernameAvailable(value));
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, editing, username]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const me = await setUsername(value);
      onSaved(me.username ?? value);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save username');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <View style={styles.row}>
        <View>
          <ThemedText type="small" themeColor="textSecondary">
            Username
          </ThemedText>
          <ThemedText type="smallBold">{username ?? 'Not set'}</ThemedText>
        </View>
        <Pressable onPress={() => setEditing(true)}>
          <ThemedText type="link" style={styles.editLink}>
            Edit
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  const invalid = value.length > 0 && !USERNAME_RE.test(value);
  const canSave = USERNAME_RE.test(value) && (value === username || available === true) && !saving;

  return (
    <View style={styles.editingBlock}>
      <ThemedText type="small" themeColor="textSecondary">
        Username
      </ThemedText>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
        placeholder="3-20 letters, numbers, underscores"
      />
      {invalid && (
        <ThemedText type="small" style={styles.error}>
          3-20 characters: letters, numbers, underscores only
        </ThemedText>
      )}
      {!invalid && value !== username && checking && (
        <ThemedText type="small" themeColor="textSecondary">
          Checking availability…
        </ThemedText>
      )}
      {!invalid && value !== username && !checking && available === false && (
        <ThemedText type="small" style={styles.error}>
          Already taken
        </ThemedText>
      )}
      {!invalid && value !== username && !checking && available === true && (
        <ThemedText type="small" style={styles.success}>
          Available
        </ThemedText>
      )}
      {error && (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      )}
      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => {
            setEditing(false);
            setValue(username ?? '');
          }}>
          <ThemedText type="link" themeColor="textSecondary">
            Cancel
          </ThemedText>
        </Pressable>
        <Pressable style={[styles.saveButton, !canSave && styles.saveButtonDisabled]} disabled={!canSave} onPress={handleSave}>
          <ThemedText type="smallBold" style={styles.saveButtonText}>
            {saving ? 'Saving…' : 'Save'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editLink: { color: Brand.navy },
  editingBlock: { gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  error: { color: '#D64545' },
  success: { color: '#2E9E5B' },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.three, alignItems: 'center' },
  saveButton: {
    backgroundColor: Brand.navy,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: '#ffffff' },
});
