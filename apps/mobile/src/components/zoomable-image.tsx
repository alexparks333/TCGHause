import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const MAX_SCALE = 4;

export function ZoomableImage({
  source,
  width,
  height,
  onZoomChange,
}: {
  source: string;
  width: number;
  height: number;
  /** Called with whether the image is currently zoomed past 1x — lets the
   * parent gallery disable page-swiping and swipe-to-dismiss while zoomed,
   * so panning around a zoomed photo doesn't fight either of those. */
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  function reportZoom(zoomed: boolean) {
    onZoomChange?.(zoomed);
  }

  function clampTranslation() {
    'worklet';
    // Keep the visible image from being dragged entirely off-screen — the
    // further zoomed in, the more room there is to pan.
    const maxX = (width * (scale.value - 1)) / 2;
    const maxY = (height * (scale.value - 1)) / 2;
    translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value));
    translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value));
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
  }

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      clampTranslation();
      runOnJS(reportZoom)(scale.value > 1.01);
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      if (savedScale.value <= 1) return;
      clampTranslation();
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomingIn = scale.value <= 1.01;
      scale.value = withTiming(zoomingIn ? 2.5 : 1);
      savedScale.value = zoomingIn ? 2.5 : 1;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      runOnJS(reportZoom)(zoomingIn);
    });

  const composedGesture = Gesture.Exclusive(doubleTapGesture, Gesture.Simultaneous(pinchGesture, panGesture));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <AnimatedImage
        source={source}
        style={[{ width, height }, animatedStyle]}
        contentFit="contain"
        transition={150}
      />
    </GestureDetector>
  );
}
