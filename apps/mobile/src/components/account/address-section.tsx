import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { Colors, Spacing } from '@/constants/theme';
import { saveMyAddress, type Address, type AddressInput } from '@/lib/api';

const EMPTY: AddressInput = {
  fullName: '',
  line1: '',
  line2: null,
  city: '',
  state: '',
  postalCode: '',
  country: '',
  phone: null,
};

export function AddressSection({
  address,
  onSaved,
}: {
  address: Address | null;
  onSaved: (address: Address) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AddressInput>(address ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field(key: keyof AddressInput, label: string, options?: { optional?: boolean }) {
    return (
      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
          {options?.optional ? ' (optional)' : ''}
        </ThemedText>
        <TextInput
          style={styles.input}
          value={form[key] ?? ''}
          onChangeText={(text) => setForm((f) => ({ ...f, [key]: text || (options?.optional ? null : '') }))}
        />
      </View>
    );
  }

  async function handleSave() {
    setError(null);
    if (!form.fullName || !form.line1 || !form.city || !form.state || !form.postalCode || !form.country) {
      setError('Please fill in all required fields');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveMyAddress(form);
      onSaved(saved);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save address');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <View>
        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            Shipping address
          </ThemedText>
          <Pressable onPress={() => setEditing(true)}>
            <ThemedText type="link" style={styles.editLink}>
              {address ? 'Edit' : 'Add'}
            </ThemedText>
          </Pressable>
        </View>
        {address ? (
          <ThemedText type="small">
            {address.fullName}
            {'\n'}
            {address.line1}
            {address.line2 ? `\n${address.line2}` : ''}
            {'\n'}
            {address.city}, {address.state} {address.postalCode}
            {'\n'}
            {address.country}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No address on file. Only you and a buyer/seller you transact with can see it.
          </ThemedText>
        )}
      </View>
    );
  }

  return (
    <View style={styles.editingBlock}>
      <ThemedText type="small" themeColor="textSecondary">
        Shipping address — only visible to you and whoever you buy from or sell to
      </ThemedText>
      {field('fullName', 'Full name')}
      {field('line1', 'Address line 1')}
      {field('line2', 'Address line 2', { optional: true })}
      {field('city', 'City')}
      {field('state', 'State')}
      {field('postalCode', 'Postal code')}
      {field('country', 'Country')}
      {field('phone', 'Phone', { optional: true })}
      {error && (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      )}
      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => {
            setEditing(false);
            setForm(address ?? EMPTY);
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.one },
  editLink: { color: Brand.navy },
  editingBlock: { gap: Spacing.two },
  field: { gap: Spacing.one },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.backgroundSelected,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
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
