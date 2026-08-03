import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ImageGallery } from '@/components/image-gallery';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_DISTANCE = 100;
const DISMISS_VELOCITY = 800;

export function FullscreenGallery({
  visible,
  imageUrls,
  initialIndex,
  onClose,
}: {
  visible: boolean;
  imageUrls: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  // While a photo is pinch-zoomed, page-swiping and swipe-to-dismiss are
  // both disabled — otherwise panning around a zoomed photo would fight
  // both of those gestures.
  const [isZoomed, setIsZoomed] = useState(false);

  // Plain PanResponder doesn't reliably win against a nested horizontal
  // FlatList's own native scroll gesture recognizer — react-native-
  // gesture-handler is built specifically to arbitrate this correctly.
  // failOffsetX releases the gesture to the carousel's native horizontal
  // scroll if the drag turns out to be mostly sideways; activeOffsetY only
  // starts recognizing once there's real downward movement, so swiping
  // between photos still works untouched.
  const panGesture = Gesture.Pan()
    .enabled(!isZoomed)
    .activeOffsetY([20, 1000])
    .failOffsetX([-20, 20])
    .onEnd((event) => {
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(onClose)();
      }
    });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Modal content renders in its own native window, separate from the
          app's own view tree — a GestureHandlerRootView anywhere in the
          main app does NOT extend into it, so this needs its own. */}
      <GestureHandlerRootView style={styles.container}>
        <GestureDetector gesture={panGesture}>
          <View style={styles.container}>
            <ImageGallery
              imageUrls={imageUrls}
              initialIndex={initialIndex}
              height={SCREEN_HEIGHT}
              contentFit="contain"
              zoomable
              scrollEnabled={!isZoomed}
              onZoomChange={setIsZoomed}
            />

            <SafeAreaView style={styles.dismissWrap} pointerEvents="box-none">
              <Pressable hitSlop={16} style={styles.dismissButton} onPress={onClose}>
                <SymbolView name="chevron.down" size={20} tintColor="#ffffff" fallback={null} />
              </Pressable>
            </SafeAreaView>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  dismissWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 12,
  },
  dismissButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});
