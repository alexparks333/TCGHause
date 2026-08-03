import { supabase } from './supabase';
import type { Listing, Me, MyBid } from './types';

// Expo env vars need the EXPO_PUBLIC_ prefix to be inlined into the client
// bundle (Expo's equivalent of Next's NEXT_PUBLIC_ convention). Must be a
// LAN IP (not localhost) when running on a physical phone via Expo Go —
// localhost from the phone's perspective is the phone itself. See
// apps/mobile/.env.example.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

// Every screen in this app is behind auth (Stack.Protected in
// src/app/_layout.tsx), so unlike apps/web (which has server-rendered
// public pages that fetch without a session) this client always has one
// available — still guards for a missing token rather than assuming.
export async function apiFetch(path: string, options: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface ListingFilters {
  game?: string;
  search?: string;
}

export async function getActiveListings(filters: ListingFilters = {}): Promise<Listing[]> {
  const params = new URLSearchParams();
  if (filters.game) params.set('game', filters.game);
  if (filters.search) params.set('q', filters.search);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  const res = await fetch(`${API_URL}/listings${query}`);
  if (!res.ok) throw new Error(`Failed to load listings: ${res.status}`);
  return res.json();
}

export async function getListingCounts(): Promise<Record<string, number>> {
  const res = await fetch(`${API_URL}/listings/counts`);
  if (!res.ok) throw new Error(`Failed to load listing counts: ${res.status}`);
  return res.json();
}

export async function getListing(id: string): Promise<Listing | null> {
  const res = await fetch(`${API_URL}/listings/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load listing: ${res.status}`);
  return res.json();
}

export async function getMyBids(): Promise<MyBid[]> {
  return apiFetch('/me/bids');
}

export async function getMe(): Promise<Me> {
  return apiFetch('/me');
}

export interface BidResult {
  currentPriceCents: number;
  highBidderId: string;
  youAreHighBidder: boolean;
  endsAt: string;
  bidCount: number;
}

export async function placeBid(listingId: string, maxBidCents: number): Promise<BidResult> {
  return apiFetch(`/listings/${listingId}/bids`, {
    method: 'POST',
    body: JSON.stringify({ maxBidCents }),
  });
}

// --- Account settings — mirrors apps/web/lib/api.ts exactly, same Go API ---

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/usernames/available?username=${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error(`Failed to check username: ${res.status}`);
  const data = await res.json();
  return Boolean(data.available);
}

export async function setUsername(username: string): Promise<Me> {
  return apiFetch('/me/username', { method: 'POST', body: JSON.stringify({ username }) });
}

export async function setBio(bio: string): Promise<Me> {
  return apiFetch('/me/bio', { method: 'POST', body: JSON.stringify({ bio }) });
}

export interface Address {
  fullName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
  updatedAt: string;
}

export async function getMyAddress(): Promise<Address | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`${API_URL}/me/address`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load address: ${res.status}`);
  return res.json();
}

export type AddressInput = Omit<Address, 'updatedAt'>;

export async function saveMyAddress(address: AddressInput): Promise<Address> {
  return apiFetch('/me/address', { method: 'POST', body: JSON.stringify(address) });
}

export interface Review {
  id: string;
  sellerId: string;
  reviewerId: string;
  reviewerUsername: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface ReviewSummary {
  averageRating: number;
  count: number;
  reviews: Review[];
}

export async function getSellerReviews(username: string): Promise<ReviewSummary> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}/reviews`);
  if (!res.ok) throw new Error(`Failed to load reviews: ${res.status}`);
  return res.json();
}

// --- Watchlist — mirrors apps/web's per-card heart toggle exactly ---

export interface WatchStatus {
  watching: boolean;
  watcherCount: number;
}

export async function getMyWatchedIds(): Promise<Set<string>> {
  const ids: string[] = await apiFetch('/me/watchlist');
  return new Set(ids);
}

export async function watchListing(listingId: string): Promise<WatchStatus> {
  return apiFetch(`/listings/${listingId}/watch`, { method: 'POST' });
}

export async function unwatchListing(listingId: string): Promise<WatchStatus> {
  return apiFetch(`/listings/${listingId}/watch`, { method: 'DELETE' });
}
