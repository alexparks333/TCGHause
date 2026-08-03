import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Colors, Spacing } from '@/constants/theme';
import { setBio } from '@/lib/api';

const MAX_LENGTH = 500;

export function BioSection({ bio, onSaved }: { bio: string | null; onSaved: (bio: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await setBio(value);
      onSaved(value);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save bio');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <View>
        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            Bio
          </ThemedText>
          <Pressable onPress={() => setEditing(true)}>
            <ThemedText type="link" style={styles.editLink}>
              Edit
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small">{bio || 'No bio yet.'}</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.editingBlock}>
      <ThemedText type="small" themeColor="textSecondary">
        Bio
      </ThemedText>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        multiline
        maxLength={MAX_LENGTH}
        placeholder="Tell buyers a bit about yourself"
      />
      <ThemedText type="small" themeColor="textSecondary">
        {value.length}/{MAX_LENGTH}
      </ThemedText>
      {error && (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      )}
      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => {
            setEditing(false);
            setValue(bio ?? '');
          }}>
          <ThemedText type="link" themeColor="textSecondary">
            Cancel
          </ThemedText>
        </Pressable>
        <Pressable style={styles.saveButton} disabled={saving} onPress={handleSave}>
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
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: { color: '#D64545' },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.three, alignItems: 'center' },
  saveButton: {
    backgroundColor: Brand.navy,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  saveButtonText: { color: '#ffffff' },
});
