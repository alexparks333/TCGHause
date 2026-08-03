import AsyncStorage from '@react-native-async-storage/async-storage';

// Real, device-local view history — not a fabricated "recently viewed"
// list. There's no backend endpoint for this (no such concept exists in
// apps/api yet), so it's tracked entirely on-device: recorded whenever the
// listing detail screen mounts, read back as an ordered list of ids for the
// Browse screen's strip.
const STORAGE_KEY = 'recently-viewed-listing-ids';
const MAX_ENTRIES = 20;

export async function recordViewed(listingId: string): Promise<void> {
  const ids = await getRecentlyViewedIds(MAX_ENTRIES);
  const next = [listingId, ...ids.filter((id) => id !== listingId)].slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function getRecentlyViewedIds(limit = 10): Promise<string[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const ids: string[] = JSON.parse(raw);
    return ids.slice(0, limit);
  } catch {
    return [];
  }
}
