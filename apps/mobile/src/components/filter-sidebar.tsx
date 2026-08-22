import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { SoftShadow } from '@/constants/shadow';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { ListingFilters } from '@/lib/api';
import { formatPrice } from '@/lib/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(300, SCREEN_WIDTH * 0.84);

// Mirrors apps/web/components/FilterSidebar.tsx's own constants exactly.
const PRICE_MIN_CENTS = 0;
const PRICE_MAX_CENTS = 100_000; // $1,000 — a practical v1 cap, not a hard product limit
const PRICE_STEP = 100;
const TIME_LEFT_MAX_HOURS = 168; // 7 days — the longest real auction length (CLAUDE.md §6.1)
const TIME_LEFT_STEP = 1;

// Mirrors apps/api/internal/catalog.ConditionOrder exactly (worst to best)
// — kept in sync by hand, same as apps/web/components/filters/
// ConditionSlider.tsx's own copy of this list.
const CONDITIONS = ['Damaged', 'Heavily Played', 'Moderately Played', 'Lightly Played', 'Near Mint'];

// The subset of ListingFilters this panel drives — game/search stay owned
// by GameFilterBar/the search box, same split as apps/web's FilterSidebar
// (CLAUDE.md §6.14/§6.15: the sidebar reflects game/query as removable
// chips rather than setting them itself).
export type SidebarFilters = Pick<
  ListingFilters,
  'sold' | 'fixedOnly' | 'priceMinCents' | 'priceMaxCents' | 'conditionMin' | 'timeLeftMinHours' | 'timeLeftMaxHours'
>;

export function hasActiveSidebarFilters(f: SidebarFilters): boolean {
  return Boolean(
    f.sold ||
      f.fixedOnly ||
      f.priceMinCents !== undefined ||
      f.priceMaxCents !== undefined ||
      f.conditionMin ||
      f.timeLeftMinHours !== undefined ||
      f.timeLeftMaxHours !== undefined,
  );
}

// Mobile counterpart to apps/web/components/FilterSidebar.tsx — same
// filter set (Sold, Buy It Now only, Price, Condition, Time Left),
// applied against the same GET /listings query params. Web collapses
// left-to-right into a slim icon rail that's permanently part of the
// page's flex layout; that would shove every other homepage element over
// on a phone-width screen, so this is a small floating arrow tab fixed to
// the left edge (position: absolute, outside the normal layout flow —
// nothing else on screen moves when it appears) that pops a full-height
// slide-in panel, same mechanism as AccountSidebar mirrored to the left
// edge instead of the right.
export function FilterSidebar({
  activeGame,
  activeQuery,
  filters,
  onApply,
  onClearGame,
  onClearQuery,
}: {
  activeGame: string | null;
  activeQuery: string;
  filters: SidebarFilters;
  onApply: (next: SidebarFilters) => void;
  onClearGame: () => void;
  onClearQuery: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SidebarFilters>(filters);
  const translateX = useSharedValue(-PANEL_WIDTH);

  useEffect(() => {
    translateX.value = withTiming(open ? 0 : -PANEL_WIDTH, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [open, translateX]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  function openPanel() {
    setDraft(filters);
    setOpen(true);
  }

  // Web's plain <form> always submits both ends of a range regardless of
  // where the handles sit; here we collapse a range back to "no filter"
  // (undefined) when it's still spanning the full min-max, so dragging
  // both handles out to the edges and applying doesn't send a pointless
  // priceMin=0&priceMax=100000 to the API or leave the tab's "active"
  // dot lit for a filter that isn't actually narrowing anything.
  function apply() {
    setOpen(false);
    const priceIsDefault =
      (draft.priceMinCents ?? PRICE_MIN_CENTS) === PRICE_MIN_CENTS &&
      (draft.priceMaxCents ?? PRICE_MAX_CENTS) === PRICE_MAX_CENTS;
    const timeIsDefault =
      (draft.timeLeftMinHours ?? 0) === 0 &&
      (draft.timeLeftMaxHours ?? TIME_LEFT_MAX_HOURS) === TIME_LEFT_MAX_HOURS;
    onApply({
      ...draft,
      priceMinCents: priceIsDefault ? undefined : (draft.priceMinCents ?? PRICE_MIN_CENTS),
      priceMaxCents: priceIsDefault ? undefined : (draft.priceMaxCents ?? PRICE_MAX_CENTS),
      timeLeftMinHours: timeIsDefault ? undefined : (draft.timeLeftMinHours ?? 0),
      timeLeftMaxHours: timeIsDefault ? undefined : (draft.timeLeftMaxHours ?? TIME_LEFT_MAX_HOURS),
    });
  }

  function clearAll() {
    setDraft({});
    setOpen(false);
    onApply({});
  }

  const hasAppliedFilters = hasActiveSidebarFilters(filters) || Boolean(activeGame) || Boolean(activeQuery);

  return (
    <>
      <Pressable style={styles.tab} onPress={openPanel} accessibilityLabel="Open filters" hitSlop={8}>
        <SymbolView name="chevron.right" size={15} tintColor="#ffffff" fallback={null} />
        {hasAppliedFilters && <View style={styles.tabDot} />}
      </Pressable>

      <Modal transparent visible={open} animationType="none" onRequestClose={() => setOpen(false)}>
        {/* Modal content renders in its own native window, separate from
            the app's own view tree — the app-level GestureHandlerRootView
            (app/_layout.tsx) does NOT extend into it, so the sliders below
            (each its own GestureDetector) need one here too. */}
        <GestureHandlerRootView style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close filters" />
          <Animated.View style={[styles.panel, panelStyle]}>
            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
              <View style={styles.header}>
                <ThemedText type="smallBold">Filters</ThemedText>
                {hasAppliedFilters && (
                  <Pressable onPress={clearAll} hitSlop={8}>
                    <ThemedText type="small" style={styles.clearAll}>
                      Clear all
                    </ThemedText>
                  </Pressable>
                )}
              </View>

              <ScrollView contentContainerStyle={styles.scroll}>
                {(activeGame || activeQuery) && (
                  <View style={styles.chipRow}>
                    {activeGame && (
                      <Pressable
                        style={styles.chip}
                        onPress={() => {
                          setOpen(false);
                          onClearGame();
                        }}>
                        <ThemedText style={styles.chipText}>{activeGame}</ThemedText>
                        <SymbolView name="xmark" size={10} tintColor="#ffffff" fallback={null} />
                      </Pressable>
                    )}
                    {activeQuery && (
                      <Pressable
                        style={styles.chip}
                        onPress={() => {
                          setOpen(false);
                          onClearQuery();
                        }}>
                        <ThemedText style={styles.chipText}>&ldquo;{activeQuery}&rdquo;</ThemedText>
                        <SymbolView name="xmark" size={10} tintColor="#ffffff" fallback={null} />
                      </Pressable>
                    )}
                  </View>
                )}

                <Toggle
                  label="Sold"
                  value={Boolean(draft.sold)}
                  onChange={(v) => setDraft((d) => ({ ...d, sold: v || undefined }))}
                />
                <Toggle
                  label="Buy It Now only"
                  value={Boolean(draft.fixedOnly)}
                  onChange={(v) => setDraft((d) => ({ ...d, fixedOnly: v || undefined }))}
                />

                <DualRangeSlider
                  label="Price"
                  min={PRICE_MIN_CENTS}
                  max={PRICE_MAX_CENTS}
                  step={PRICE_STEP}
                  minValue={draft.priceMinCents ?? PRICE_MIN_CENTS}
                  maxValue={draft.priceMaxCents ?? PRICE_MAX_CENTS}
                  onChangeMin={(v) => setDraft((d) => ({ ...d, priceMinCents: v }))}
                  onChangeMax={(v) => setDraft((d) => ({ ...d, priceMaxCents: v }))}
                  unit="cents"
                />

                <View style={styles.group}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.groupLabel}>
                    Condition
                  </ThemedText>
                  <ConditionDropdown
                    value={draft.conditionMin}
                    onChange={(v) => setDraft((d) => ({ ...d, conditionMin: v }))}
                  />
                </View>

                <DualRangeSlider
                  label="Time Left"
                  min={0}
                  max={TIME_LEFT_MAX_HOURS}
                  step={TIME_LEFT_STEP}
                  minValue={draft.timeLeftMinHours ?? 0}
                  maxValue={draft.timeLeftMaxHours ?? TIME_LEFT_MAX_HOURS}
                  onChangeMin={(v) => setDraft((d) => ({ ...d, timeLeftMinHours: v }))}
                  onChangeMax={(v) => setDraft((d) => ({ ...d, timeLeftMaxHours: v }))}
                  unit="hours"
                />
              </ScrollView>

              <View style={styles.footer}>
                <Pressable style={styles.applyButton} onPress={apply}>
                  <ThemedText style={styles.applyButtonText}>Apply Filters</ThemedText>
                </Pressable>
              </View>
            </SafeAreaView>
          </Animated.View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable style={styles.toggleRow} onPress={() => onChange(!value)}>
      <ThemedText type="small">{label}</ThemedText>
      <View style={[styles.checkbox, value && styles.checkboxChecked]}>
        {value && <SymbolView name="checkmark" size={11} tintColor="#ffffff" fallback={null} />}
      </View>
    </Pressable>
  );
}

// A simple inline-expanding list rather than a floating overlay — this
// lives inside the panel's ScrollView, and an absolutely-positioned
// dropdown would either get clipped by the ScrollView's bounds or need its
// own portal; expanding in normal flow (pushing whatever's below it down,
// within an already-scrollable container) avoids both.
function ConditionDropdown({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = value ? `${value}+` : 'Any';

  return (
    <View>
      <Pressable style={styles.dropdownHeader} onPress={() => setOpen((o) => !o)}>
        <ThemedText type="small">{label}</ThemedText>
        <SymbolView
          name={open ? 'chevron.up' : 'chevron.down'}
          size={13}
          tintColor={Colors.light.textSecondary}
          fallback={null}
        />
      </Pressable>
      {open && (
        <View style={styles.dropdownList}>
          <Pressable
            style={styles.dropdownOption}
            onPress={() => {
              onChange(undefined);
              setOpen(false);
            }}>
            <ThemedText type="small" style={!value ? styles.dropdownOptionTextSelected : undefined}>
              Any
            </ThemedText>
          </Pressable>
          {CONDITIONS.slice(1).map((c) => (
            <Pressable
              key={c}
              style={styles.dropdownOption}
              onPress={() => {
                onChange(c);
                setOpen(false);
              }}>
              <ThemedText type="small" style={value === c ? styles.dropdownOptionTextSelected : undefined}>
                {c}+
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

type SliderUnit = 'cents' | 'hours';

// Mirrors apps/web/components/filters/DualRangeSlider.tsx's own formatHours
// exactly.
function formatHours(hours: number): string {
  if (hours <= 0) return 'Now';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem === 0 ? `${days}d` : `${days}d ${rem}h`;
}

function formatSliderValue(unit: SliderUnit, value: number): string {
  return unit === 'cents' ? formatPrice(value) : formatHours(value);
}

// Two stacked single-handle sliders (not an overlapping dual-thumb
// widget) — mirrors apps/web/components/filters/DualRangeSlider.tsx's own
// "simpler and more reliable than the usual two-thumbs-on-one-track hack"
// call exactly, just with native touch tracks instead of two <input
// type="range">s.
function DualRangeSlider({
  label,
  min,
  max,
  step,
  minValue,
  maxValue,
  onChangeMin,
  onChangeMax,
  unit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  minValue: number;
  maxValue: number;
  onChangeMin: (v: number) => void;
  onChangeMax: (v: number) => void;
  unit: SliderUnit;
}) {
  return (
    <View style={styles.group}>
      <View style={styles.sliderHeader}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.groupLabel}>
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatSliderValue(unit, minValue)} – {formatSliderValue(unit, maxValue)}
        </ThemedText>
      </View>
      <View style={styles.sliderStack}>
        <SliderTrack
          min={min}
          max={max}
          step={step}
          value={minValue}
          onChange={(v) => onChangeMin(Math.min(v, maxValue))}
          accessibilityLabel={`Minimum ${label}`}
        />
        <SliderTrack
          min={min}
          max={max}
          step={step}
          value={maxValue}
          onChange={(v) => onChangeMax(Math.max(v, minValue))}
          accessibilityLabel={`Maximum ${label}`}
        />
      </View>
    </View>
  );
}

const THUMB_SIZE = 22;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

// A single draggable track — tapping or dragging anywhere on it jumps the
// thumb to that position (computed from the touch's x relative to the
// track itself, since the GestureDetector is attached directly to the
// track View). `.runOnJS(true)` routes the gesture callbacks straight to
// the JS thread so they can call plain React state setters directly —
// there's no UI-thread-critical animation math here (unlike
// zoomable-image.tsx's pinch/pan), so reanimated shared values would just
// be extra ceremony for no benefit.
function SliderTrack({
  min,
  max,
  step,
  value,
  onChange,
  accessibilityLabel,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  accessibilityLabel: string;
}) {
  const [width, setWidth] = useState(0);

  function commitFromX(x: number) {
    if (width <= 0) return;
    const p = clamp(x / width, 0, 1);
    const raw = min + p * (max - min);
    const stepped = Math.round(raw / step) * step;
    onChange(clamp(stepped, min, max));
  }

  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => commitFromX(e.x))
    .onUpdate((e) => commitFromX(e.x));

  const progress = width > 0 ? clamp((value - min) / (max - min), 0, 1) : 0;

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.sliderTrack}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={accessibilityLabel}>
        <View style={styles.sliderTrackLine} />
        <View style={[styles.sliderTrackFill, { width: `${progress * 100}%` }]} />
        <View style={[styles.sliderThumb, { left: progress * Math.max(0, width - THUMB_SIZE) }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  tab: {
    // position: 'absolute' takes this fully out of layout flow — it
    // overlays the screen rather than reserving space in it, so it never
    // eats into the FlatList's own horizontal padding no matter how it's
    // styled here.
    position: 'absolute',
    left: 0,
    top: '50%',
    transform: [{ translateY: -22 }],
    width: 26,
    height: 44,
    borderTopRightRadius: Radius.md,
    borderBottomRightRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,41,0.5)',
    zIndex: 20,
    ...SoftShadow,
  },
  tabDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Brand.gold,
  },
  modalRoot: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: Colors.light.surface,
  },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  clearAll: { color: Brand.navy, fontWeight: '600' },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.four },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Brand.navy,
  },
  chipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Brand.navy, borderColor: Brand.navy },
  group: { gap: Spacing.two },
  groupLabel: { textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.4 },
  sliderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sliderStack: { gap: 2 },
  sliderTrack: { height: 32, justifyContent: 'center' },
  sliderTrackLine: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.light.border,
  },
  sliderTrackFill: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    backgroundColor: Brand.navy,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: Brand.navy,
    borderWidth: 2,
    borderColor: '#ffffff',
    ...SoftShadow,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
  },
  dropdownList: {
    marginTop: Spacing.one,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: 'hidden',
  },
  dropdownOption: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.two + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
  },
  dropdownOptionTextSelected: { color: Brand.navy, fontWeight: '700' },
  footer: {
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.border,
  },
  applyButton: {
    paddingVertical: Spacing.two + 4,
    borderRadius: Radius.full,
    alignItems: 'center',
    backgroundColor: Brand.navy,
  },
  applyButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
});
