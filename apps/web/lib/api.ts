import { createClient } from "./supabase/client";
import type { Listing, MyBid } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// For Client Components only (uses the browser Supabase client to attach
// the current session's access token). Server Components fetch the public
// GET endpoints directly with plain fetch() — no auth needed for those.
export async function apiFetch(path: string, options: RequestInit = {}) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// Mirrors apps/api/internal/listing.ListFilters exactly (CLAUDE.md §6.15) —
// an options object since there are too many optional filters now for a
// positional signature to stay readable.
export interface ListingFilters {
  sellerId?: string;
  game?: string;
  search?: string;
  finished?: boolean;
  fixedOnly?: boolean;
  priceMinCents?: number;
  priceMaxCents?: number;
  conditionMin?: string;
  timeLeftMinHours?: number;
  timeLeftMaxHours?: number;
}

// Server Components call these directly — the underlying endpoints are
// public GETs, no auth needed. `cache: "no-store"` because auction prices
// and bid counts change on every bid; this is real-time data, not
// something to serve stale from Next's fetch cache.
export async function getActiveListings(filters: ListingFilters = {}): Promise<Listing[]> {
  const params = new URLSearchParams();
  if (filters.sellerId) params.set("seller_id", filters.sellerId);
  if (filters.game) params.set("game", filters.game);
  if (filters.search) params.set("q", filters.search);
  if (filters.finished) params.set("finished", "true");
  if (filters.fixedOnly) params.set("fixedOnly", "true");
  if (filters.priceMinCents !== undefined) params.set("priceMin", String(filters.priceMinCents));
  if (filters.priceMaxCents !== undefined) params.set("priceMax", String(filters.priceMaxCents));
  if (filters.conditionMin) params.set("conditionMin", filters.conditionMin);
  if (filters.timeLeftMinHours !== undefined)
    params.set("timeLeftMin", String(filters.timeLeftMinHours));
  if (filters.timeLeftMaxHours !== undefined)
    params.set("timeLeftMax", String(filters.timeLeftMaxHours));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const res = await fetch(`${API_URL}/listings${query}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load listings: ${res.status}`);
  return res.json();
}

// Real per-game active-listing counts, site-wide — never derived from
// whatever's currently filtered/paginated, so the category bubbles always
// show the true total (CLAUDE.md §6.14).
export async function getListingCounts(): Promise<Record<string, number>> {
  const res = await fetch(`${API_URL}/listings/counts`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load listing counts: ${res.status}`);
  return res.json();
}

export async function getListing(id: string): Promise<Listing | null> {
  const res = await fetch(`${API_URL}/listings/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load listing: ${res.status}`);
  return res.json();
}

// Requires auth — Server Components pass the session's access token
// explicitly since there's no browser Supabase client available there.
export async function getMyBids(accessToken: string): Promise<MyBid[]> {
  const res = await fetch(`${API_URL}/me/bids`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load bids: ${res.status}`);
  return res.json();
}

export interface Me {
  id: string;
  email: string;
  username: string | null;
  bio: string | null;
  createdAt: string;
}

// Requires auth — same explicit-accessToken shape as getMyBids, since
// Server Components (Header, Account Settings, the claim-username page,
// the OAuth callback route) have no browser Supabase client to pull a
// session from.
export async function getMe(accessToken: string): Promise<Me> {
  const res = await fetch(`${API_URL}/me`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load profile: ${res.status}`);
  return res.json();
}

// One address per account — ship-to when buying, ship-from when selling.
// Never shown to anyone but its owner (not part of PublicUser/the seller
// profile page).
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

// Requires auth — same explicit-accessToken shape as getMe. 404 -> null
// (no address saved yet), same shape as getListing's 404 handling.
export async function getMyAddress(accessToken: string): Promise<Address | null> {
  const res = await fetch(`${API_URL}/me/address`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load address: ${res.status}`);
  return res.json();
}

// Public — no auth needed, since SignUpForm calls this before an account
// exists at all. Used by both SignUpForm and ClaimUsernameForm to
// debounce-check a candidate username before submit.
export async function checkUsernameAvailable(username: string): Promise<boolean> {
  const res = await fetch(
    `${API_URL}/usernames/available?username=${encodeURIComponent(username)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to check username: ${res.status}`);
  const data = await res.json();
  return Boolean(data.available);
}

export interface PublicUser {
  id: string;
  username: string | null;
  bio: string | null;
  createdAt: string;
}

// Public — no auth needed. Backs the seller profile page
// (app/seller/[username]/page.tsx). 404 -> null, same shape as getListing.
export async function getUserByUsername(username: string): Promise<PublicUser | null> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load user: ${res.status}`);
  return res.json();
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

// Public — no auth needed.
export async function getSellerReviews(username: string): Promise<ReviewSummary> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}/reviews`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load reviews: ${res.status}`);
  return res.json();
}

// Requires auth — same explicit-accessToken shape as getMe. Lets the
// profile page decide whether to even show the "leave a review" form,
// rather than only finding out via a 403 after the caller tries to submit.
export async function getCanReview(username: string, accessToken: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}/can-review`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.canReview);
}

export interface WatchStatus {
  watching: boolean;
  watcherCount: number;
}

// Fetched server-side (listing detail page already has the session from
// checking isOwner/currentUser) rather than from a client-side useEffect —
// a client-side "am I logged in yet" check races the page load and was the
// actual cause of watching appearing not to save: the click could fire
// before the client learned it was authenticated.
export async function getWatchStatus(listingId: string, accessToken: string): Promise<WatchStatus> {
  const res = await fetch(`${API_URL}/listings/${listingId}/watch`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load watch status: ${res.status}`);
  return res.json();
}

// Batch version for any page rendering a grid of ListingCards — one query
// instead of one fetch per card. Same server-fetched-initial-state
// reasoning as getWatchStatus.
export async function getMyWatchedIds(accessToken: string): Promise<Set<string>> {
  const res = await fetch(`${API_URL}/me/watchlist`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load watchlist: ${res.status}`);
  const ids: string[] = await res.json();
  return new Set(ids);
}
