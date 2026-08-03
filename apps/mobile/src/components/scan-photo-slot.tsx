import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CardShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.9,
  allowsEditing: false,
};

export function ScanPhotoSlot({
  label,
  hint,
  uri,
  onPicked,
  onRemoved,
}: {
  label: string;
  hint: string;
  uri: string | null;
  onPicked: (uri: string) => void;
  onRemoved: () => void;
}) {
  async function pickFromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (!result.canceled && result.assets[0]) onPicked(result.assets[0].uri);
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo library access needed', 'Enable photo access in Settings to choose a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (!result.canceled && result.assets[0]) onPicked(result.assets[0].uri);
  }

  function handlePress() {
    if (uri) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
        (index) => {
          if (index === 1) pickFromCamera();
          if (index === 2) pickFromLibrary();
        },
      );
    } else {
      Alert.alert('Add photo', undefined, [
        { text: 'Take Photo', onPress: pickFromCamera },
        { text: 'Choose from Library', onPress: pickFromLibrary },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  return (
    <View style={styles.wrap}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable style={styles.slot} onPress={handlePress}>
        {uri ? (
          <>
            <Image source={uri} style={styles.image} contentFit="cover" />
            <Pressable hitSlop={8} style={styles.removeButton} onPress={onRemoved}>
              <SymbolView name="xmark" size={12} tintColor="#333333" fallback={null} />
            </Pressable>
          </>
        ) : (
          <View style={styles.placeholder}>
            <SymbolView name="camera" size={26} tintColor={Colors.light.textSecondary} fallback={null} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              {hint}
            </ThemedText>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: Spacing.one },
  slot: {
    aspectRatio: 3 / 4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.light.surface,
    overflow: 'hidden',
    ...CardShadow,
  },
  image: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.light.backgroundSelected,
    borderRadius: Radius.lg,
    margin: 2,
  },
  hint: { textAlign: 'center', paddingHorizontal: Spacing.two },
  removeButton: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});
