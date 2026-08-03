import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, View, type ViewToken } from 'react-native';

import { ZoomableImage } from '@/components/zoomable-image';
import { Colors } from '@/constants/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;

export function ImageGallery({
  imageUrls,
  onImagePress,
  height,
  initialIndex = 0,
  contentFit = 'cover',
  zoomable = false,
  scrollEnabled = true,
  onZoomChange,
}: {
  imageUrls: string[];
  onImagePress?: (index: number) => void;
  /** Defaults to a square (aspect ratio 1) sized to screen width. */
  height?: number;
  initialIndex?: number;
  /** 'cover' crops to fill (grid/thumbnail use); 'contain' shows the whole photo, letterboxed if needed (fullscreen use). */
  contentFit?: 'cover' | 'contain';
  /** Pinch-to-zoom + pan per photo (fullscreen use only). */
  zoomable?: boolean;
  /** Disable page-swiping — used while a photo is zoomed in, so panning around it doesn't fight swiping to the next photo. */
  scrollEnabled?: boolean;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const itemWidth = SCREEN_WIDTH;
  const itemHeight = height ?? SCREEN_WIDTH;

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 51 }).current;

  return (
    <View>
      <FlatList
        data={imageUrls}
        keyExtractor={(url, i) => `${url}-${i}`}
        horizontal
        pagingEnabled
        scrollEnabled={scrollEnabled}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialScrollIndex={initialIndex > 0 ? initialIndex : undefined}
        getItemLayout={(_, index) => ({ length: itemWidth, offset: itemWidth * index, index })}
        renderItem={({ item, index }) => {
          if (zoomable) {
            return (
              <ZoomableImage
                source={item}
                width={itemWidth}
                height={itemHeight}
                onZoomChange={onZoomChange}
              />
            );
          }
          const image = (
            <Image
              source={item}
              style={[styles.image, height != null && { height, aspectRatio: undefined }]}
              contentFit={contentFit}
              transition={150}
            />
          );
          return onImagePress ? (
            <Pressable onPress={() => onImagePress(index)}>{image}</Pressable>
          ) : (
            image
          );
        }}
      />
      {imageUrls.length > 1 && (
        <View style={styles.dots}>
          {imageUrls.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: SCREEN_WIDTH, aspectRatio: 1, backgroundColor: Colors.light.backgroundElement },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dotActive: {
    width: 20,
    backgroundColor: '#ffffff',
  },
});
