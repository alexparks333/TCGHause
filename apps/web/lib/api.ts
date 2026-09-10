import { cache } from "react";
import { createClient } from "./supabase/client";
import type {
  CatalogCard,
  EndListingAction,
  EndListingReason,
  Game,
  Listing,
  MyBid,
  OfferStatus,
  ShippingPreset,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// Mirrors apps/api/internal/auction.BidResult exactly — the response from
// POST /listings/{id}/bids. Carries everything the price box needs to
// update instantly (AuctionPriceBox), no page refresh required.
export interface BidResult {
  currentPriceCents: number;
  highBidderId: string;
  youAreHighBidder: boolean;
  endsAt: string;
  bidCount: number;
}

// Thrown by apiFetch on a non-ok response — a plain Error subclass, so
// every existing `err instanceof Error ? err.message : ...` call site
// keeps working unchanged. status is what the Buy It Now checkout flow
// needs to tell "someone else already bought this" (409) apart from any
// other failure, without parsing the error text.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

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
    throw new ApiError(text || `Request failed: ${res.status}`, res.status);
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
  sold?: boolean;
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
  if (filters.sold) params.set("sold", "true");
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

// Search-as-you-type against TCG Haven's card catalog (Pokémon/Disney
// Lorcana/Riftbound only — other games always resolve to []). Omitting
// `game` merges results across every catalog-backed game
// (cardcatalog.SearchAll); passing one scopes to just that game
// (cardcatalog.Search) — the Sell wizard's CardSearch uses both, depending
// on whether the seller has picked a game in its own filter, while the
// Favorite Card widget picker always searches every game. Called directly
// from a Client Component, so no server-side caching directive; the API
// itself already caches TCG Haven's catalog in memory (internal/cardcatalog).
export async function searchCatalogCardsAllGames(query: string): Promise<CatalogCard[]> {
  const res = await fetch(`${API_URL}/catalog/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Card search failed: ${res.status}`);
  return res.json();
}

export async function searchCatalogCards(game: string, query: string): Promise<CatalogCard[]> {
  const res = await fetch(
    `${API_URL}/catalog/search?game=${encodeURIComponent(game)}&q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error(`Card search failed: ${res.status}`);
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

// Requires auth — same explicit-accessToken shape as getMyBids. Every
// listing the caller has actually bought, either format, newest first —
// the real data behind the Buy History page. Each result's paidAt
// reflects whether a real Stripe charge actually captured for it — never
// guessed, see internal/auction.MyPurchases.
export async function getMyPurchases(accessToken: string): Promise<Listing[]> {
  const res = await fetch(`${API_URL}/me/purchases`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load purchases: ${res.status}`);
  return res.json();
}

// MyPurchases' mirror image — every listing the caller has actually sold,
// newest first — the real data behind the Sold History page.
export async function getMySales(accessToken: string): Promise<Listing[]> {
  const res = await fetch(`${API_URL}/me/sales`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load sales: ${res.status}`);
  return res.json();
}

// Mirrors apps/api/internal/seller.Tier exactly.
export type SellerTier = "new" | "bronze" | "silver" | "gold" | "platinum" | "hous_trust";

// Mirrors apps/api/internal/user.ProfileSticker exactly. xPct is a
// percentage (0-100) of the canvas's width. yPx is pixels down from the
// canvas's top edge, deliberately NOT a percentage — see
// ProfileSticker's doc comment in user.go for why (the canvas's height
// grows/shrinks with the widget stack; a percentage-of-height Y would
// recompute to a different pixel position every time that happened).
// rotationDeg/scale aren't editable yet (no rotate/resize handles in the
// UI) but are shipped now so a future editor upgrade is additive, not
// another API-shape change.
export interface ProfileSticker {
  id: string;
  kind: string;
  xPct: number;
  yPx: number;
  rotationDeg: number;
  scale: number;
}

// Mirrors apps/api/internal/user.FavoriteCardRef exactly — a denormalized
// snapshot of one CatalogCard result, not a foreign key (internal/
// cardcatalog has no "get by id" lookup to re-fetch one from).
export interface FavoriteCardRef {
  id: string;
  game: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageUrl: string;
}

// Mirrors apps/api/internal/user.ProfileWidget exactly. The canvas is a
// 3-column grid — col (0-2) is which column a widget starts at; order in
// the array decides which row (a full-width type like "listings" always
// starts a fresh row; col is meaningless for it, the frontend never reads
// it there). favoriteCard is only meaningful for the "favorite_card"
// type — null means "added but not configured yet".
export interface ProfileWidget {
  id: string;
  type: string;
  col: number;
  favoriteCard: FavoriteCardRef | null;
}

// Mirrors apps/api/internal/user.ProfileCanvas exactly. The painted
// profile background: url points at a lossless PNG in the profile-canvas
// Storage bucket (the pixels never touch the Go API), width/height are the
// bitmap's intrinsic size — width is the fixed PAINT_DESIGN_WIDTH the
// owner painted at, height grows as widgets extend the page (new pixel
// rows added at the bottom, never a rescale).
export interface ProfileCanvas {
  url: string;
  width: number;
  height: number;
}

export interface Me {
  id: string;
  email: string;
  username: string | null;
  bio: string | null;
  createdAt: string;
  tier: SellerTier;
  stickers: ProfileSticker[];
  widgets: ProfileWidget[];
  profileCanvas: ProfileCanvas | null;
}

// Requires auth — same explicit-accessToken shape as getMyBids, since
// Server Components (Header, Account Settings, the claim-username page,
// the OAuth callback route) have no browser Supabase client to pull a
// session from. Wrapped in cache() — Header calls this on every page,
// and several pages (Account Settings) call it again directly with the
// same token, so without this every one of those pages paid for the Go
// API round trip twice.
export const getMe = cache(async (accessToken: string): Promise<Me> => {
  const res = await fetch(`${API_URL}/me`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load profile: ${res.status}`);
  return res.json();
});

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

// Same /me/address data as getMyAddress, but for Client Components
// (PrintLabelButton's "Change Shipping Label" edit form, which always
// prefills from this before letting the seller override it for one label)
// — apiFetch attaches the current session's token itself, same shape as
// getMyOrdersMine alongside getMyOrders.
export async function getMyAddressMine(): Promise<Address | null> {
  try {
    return await apiFetch("/me/address");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
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
  tier: SellerTier;
  stickers: ProfileSticker[];
  widgets: ProfileWidget[];
  profileCanvas: ProfileCanvas | null;
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

// Client-only (apiFetch) — always sends the caller's whole background
// arrangement, mirroring internal/user.SetStickers' replace-not-patch
// semantics.
export async function setMyStickers(stickers: ProfileSticker[]): Promise<Me> {
  return apiFetch("/me/stickers", {
    method: "POST",
    body: JSON.stringify({ stickers }),
  });
}

// Client-only (apiFetch) — always sends the caller's whole widget layout,
// mirroring internal/user.SetWidgets' replace-not-patch semantics.
export async function setMyWidgets(widgets: ProfileWidget[]): Promise<Me> {
  return apiFetch("/me/widgets", {
    method: "POST",
    body: JSON.stringify({ widgets }),
  });
}

// Client-only (apiFetch) — records the painted canvas descriptor after the
// PNG itself has been uploaded to Storage (lib/storage.ts's
// uploadProfileCanvas). null clears the painting entirely.
export async function setMyCanvas(canvas: ProfileCanvas | null): Promise<Me> {
  return apiFetch("/me/canvas", {
    method: "POST",
    body: JSON.stringify({ canvas }),
  });
}

export interface Review {
  id: string;
  sellerId: string;
  reviewerId: string;
  reviewerUsername: string | null;
  reviewerReviewCount: number;
  listingId: string;
  listingTitle: string;
  conditionAccuracy: number;
  shippingSpeed: number;
  trustworthiness: number;
  overallRating: number;
  comment: string | null;
  createdAt: string;
  sellerReply: string | null;
  sellerReplyAt?: string;
}

export interface ReviewSummary {
  averageRating: number;
  averageConditionAccuracy: number;
  averageShippingSpeed: number;
  averageTrustworthiness: number;
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

export interface ReviewableListing {
  listingId: string;
  title: string;
  endedAt: string;
}

// Requires auth — same explicit-accessToken shape as getMe. Every entry is
// a purchase (won auction) from this seller the caller hasn't reviewed
// yet — an empty array means "can't review this seller at all" (never
// bought from them), and also exactly what the review form's purchase
// picker renders. Checking this up front lets the profile page decide
// whether to even show the form, rather than only finding out via a 403
// after the caller tries to submit.
export async function getReviewablePurchases(
  username: string,
  accessToken: string
): Promise<ReviewableListing[]> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}/reviewable-purchases`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.listings ?? [];
}

// Buyer-side mirror of Review/ReviewSummary above — the seller's rating of
// the buyer on one specific order, plus that buyer's aggregate reputation
// (mirrors apps/api/internal/buyerreview exactly).
export type BuyerReviewTag = "trustworthy" | "suspicious" | "aggressive";

export interface BuyerReview {
  id: string;
  orderId: string;
  buyerId: string;
  reviewerId: string;
  listingTitle: string;
  rating: number;
  tag: BuyerReviewTag;
  comment: string | null;
  createdAt: string;
}

export interface BuyerStats {
  buysMade: number;
  refundedCount: number;
  refundedPct: number;
  claimsCount: number;
  claimsPct: number;
  tag: BuyerReviewTag | null;
  reviewCount: number;
  averageRating: number;
}

// Requires auth (the caller must be this order's seller) — same
// explicit-accessToken shape as getOrderForListing, since the order page
// fetches this server-side alongside the order itself. Null means the
// seller hasn't reviewed this buyer yet, not an error.
export async function getBuyerReviewForListing(
  listingId: string,
  accessToken: string
): Promise<BuyerReview | null> {
  const res = await fetch(`${API_URL}/listings/${listingId}/order/buyer-review`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// Client-side submit (used by BuyerReviewForm) — same apiFetch-from-a-
// component pattern as ReviewForm/SellerReplyForm.
export async function submitBuyerReview(
  listingId: string,
  input: { rating: number; tag: BuyerReviewTag; comment: string }
): Promise<BuyerReview> {
  return apiFetch(`/listings/${listingId}/order/buyer-review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Public — no auth needed, same as getSellerReviews.
export async function getBuyerStats(username: string): Promise<BuyerStats> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}/buyer-stats`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load buyer stats: ${res.status}`);
  return res.json();
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

// "Delete Listing" on the Selling page — never a real row delete server-side
// (internal/auction.EndListing flips status to 'ended'/'cancelled'
// depending on outcome, same shape as a natural auction close). A
// fixed-price listing or a never-bid-on auction needs no `input` at all —
// omit it and this sends an empty body, which the backend's EndListing
// treats as a plain, no-consequence delete. Once an auction has a real
// bid, `input` is required (`action`, plus `reason` when action is
// "cancel_bids") — mirrors eBay's own real early-ending rules
// (docs/EditListing.md). Throws ApiError on failure so the caller's own
// catch can read err.message for the specific reason (already sold, too
// close to the scheduled end to end early, etc.).
export async function cancelListing(
  listingId: string,
  input?: { action: EndListingAction; reason?: EndListingReason },
): Promise<void> {
  await apiFetch(`/listings/${listingId}`, {
    method: "DELETE",
    body: input ? JSON.stringify(input) : undefined,
  });
}

// "Edit Listing" on the Selling page — mirrors apps/api/internal/listing.
// UpdateInput exactly, which in turn mirrors eBay's own real "revise a
// listing" rules: a fixed-price listing can move its price up or down and
// change shipping freely; an auction with no bids can only lower its
// starting bid/Buy It Now price (never raise) and can still change
// shipping; an auction with any bid rejects this call outright
// (ErrHasBids) — nothing about it is editable once bidding has started,
// same as eBay. startingBidCents/shippingPreset are both no-ops when
// omitted/zero — "leave as-is," not "clear this field."
export async function updateListing(
  listingId: string,
  input: {
    title: string;
    set: string;
    cardNumber: string;
    rarity: string;
    priceCents: number;
    allowOffers: boolean;
    minOfferCents: number;
    startingBidCents?: number;
    shippingPreset?: ShippingPreset | "";
    imageUrls: string[];
  },
): Promise<Listing> {
  return apiFetch(`/listings/${listingId}`, { method: "PATCH", body: JSON.stringify(input) });
}

// Mirrors apps/api/internal/listing.PhotoEdit exactly — one row of a
// listing's photo-edit audit trail (added whenever Update's imageUrls
// actually changes). Admin-only; see getListingPhotoHistory below.
export interface PhotoEdit {
  id: string;
  listingId: string;
  sellerId: string;
  beforeImageUrls: string[];
  afterImageUrls: string[];
  createdAt: string;
}

// Admin-only (server enforces via the same ADMIN_EMAILS allowlist as
// getAdminClaims) — the claim detail page's "did the photos change right
// before this sold" timeline. Empty array, never an error, for a listing
// whose photos were never edited.
export async function getListingPhotoHistory(
  listingId: string,
  accessToken: string,
): Promise<PhotoEdit[]> {
  const res = await fetch(`${API_URL}/listings/${listingId}/photo-history`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

export interface CelebrationItem {
  listingId: string;
  title: string;
  imageUrl?: string;
  priceCents: number;
  // Only present on an item from `reviews` — a win/sale toast reads
  // priceCents, a review toast reads this instead (the two are never both
  // populated on the same item).
  rating?: number;
}

export interface Celebrations {
  wins: CelebrationItem[];
  sales: CelebrationItem[];
  reviews: CelebrationItem[];
}

// Client-only (CelebrationWatcher polls this from the browser) — uses
// apiFetch rather than an explicit accessToken param since there's no
// server-rendered page that needs this on first paint, unlike
// getMyBids/getMyWatchedIds above.
export async function getMyCelebrations(): Promise<Celebrations> {
  return apiFetch("/me/celebrations");
}

// Marks one win/sale celebration as shown so GET /me/celebrations never
// returns it again — called once a toast actually starts displaying it,
// not on dismiss, so a tab closed mid-animation still counts as "seen".
export async function ackCelebration(
  listingId: string,
  // "offer" isn't a real backend celebration kind yet (see
  // CelebrationToast's KIND_ICON comment) — the API 400s on it, which the
  // caller already swallows, same as any other ack failure.
  kind: "win" | "sale" | "review" | "offer",
): Promise<void> {
  await apiFetch("/me/celebrations/ack", {
    method: "POST",
    body: JSON.stringify({ listingId, kind }),
  });
}

// Mirrors apps/api/internal/notification.Notification — the persistent,
// markable-as-read list behind the header bell. Distinct from
// CelebrationItem above: a celebration plays once and disappears, these
// stay in the list until read.
export interface AppNotification {
  id: string;
  kind:
    | "won"
    | "sold"
    | "outbid"
    | "bought"
    | "seller_review"
    | "buyer_review"
    | "offer_received"
    | "offer_accepted"
    | "offer_declined";
  listingId: string;
  listingTitle: string;
  listingGame: Game;
  listingImageUrl?: string;
  // Set on the three offer_* kinds only — lets the bell route straight to
  // the specific offer. A listing can have several different buyers each
  // with their own pending offer at once, so the listing alone doesn't
  // disambiguate which one this notification is about.
  offerId?: string;
  readAt: string | null;
  createdAt: string;
}

export interface MyNotifications {
  notifications: AppNotification[];
  unreadCount: number;
}

// Server-side, explicit accessToken — same shape as getMyBids/
// getMyWatchedIds. Header fetches this once so NotificationBell has a real
// server-rendered unread count on first paint instead of flashing 0 before
// its own poll resolves (same "no client-only initial state" reasoning as
// WatchBadge/the top-bidder indicator).
export async function getMyNotifications(accessToken: string): Promise<MyNotifications> {
  const res = await fetch(`${API_URL}/me/notifications`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load notifications: ${res.status}`);
  return res.json();
}

// Client-only (NotificationBell polls this from the browser) — uses
// apiFetch rather than an explicit accessToken param, same distinction as
// getMyCelebrations vs getMyBids above.
export async function getMyNotificationsClient(): Promise<MyNotifications> {
  return apiFetch("/me/notifications");
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch(`/me/notifications/${id}/read`, { method: "POST" });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch("/me/notifications/read-all", { method: "POST" });
}

// Mirrors apps/api/internal/offer.Offer exactly — real offer/negotiation
// state on top of a listing's Buy It Now price (listing.allowOffers/
// minOfferCents). Denormalized with the listing's title/photo and both
// participants' usernames, same "no N+1 per row" shape as
// MessageThreadSummary, so a list of offers never needs a second round
// trip per row.
export interface Offer {
  id: string;
  listingId: string;
  listingTitle: string;
  listingImageUrl?: string;
  buyerId: string;
  buyerUsername: string | null;
  sellerId: string;
  sellerUsername: string | null;
  amountCents: number;
  status: OfferStatus;
  createdAt: string;
  respondedAt?: string;
}

// Submits a real offer on listingId — the backend re-validates
// allowOffers/minOfferCents/the Buy It Now price regardless; this is what
// backs the "Make an Offer" button's own client-side check.
export async function submitOffer(listingId: string, amountCents: number): Promise<Offer> {
  return apiFetch(`/listings/${listingId}/offers`, {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}

// Every offer the caller has ever sent, across every listing — backs the
// buyer-facing "Offers" section on /account/bids-offers. Server-side,
// explicit accessToken — same shape as getMyBids — so that page renders
// with real data on first paint, no client-only loading flash.
export async function getMySentOffers(accessToken: string): Promise<Offer[]> {
  const res = await fetch(`${API_URL}/me/offers/sent`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load offers: ${res.status}`);
  return res.json();
}

// Every offer the caller has ever received, across every listing they
// sell — the seller-side counterpart to getMySentOffers, backing the
// combined Offers tab on /account/bids-offers (accept/decline live right
// there, not just on each listing's own page). Same server-side,
// explicit-accessToken shape.
export async function getMyReceivedOffers(accessToken: string): Promise<Offer[]> {
  const res = await fetch(`${API_URL}/me/offers/received`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load offers: ${res.status}`);
  return res.json();
}

// Every offer on one specific listing — only that listing's own seller can
// call this (internal/offer.ListForListing enforces it server-side too).
// Backs the "Offers" panel a seller sees on their own listing page.
// Server-side initial fetch, same explicit-accessToken shape as above —
// app/listing/[id]/page.tsx calls this only when isOwner, mirroring how it
// already only fetches `order` for an owner viewing their own sold listing.
export async function getOffersForListing(listingId: string, accessToken: string): Promise<Offer[]> {
  const res = await fetch(`${API_URL}/listings/${listingId}/offers`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load offers: ${res.status}`);
  return res.json();
}

export async function acceptOffer(offerId: string): Promise<Offer> {
  return apiFetch(`/offers/${offerId}/accept`, { method: "POST" });
}

export async function declineOffer(offerId: string): Promise<Offer> {
  return apiFetch(`/offers/${offerId}/decline`, { method: "POST" });
}

// Mirrors apps/api/internal/message exactly — real buyer/seller direct
// messaging, replacing lib/mock-account.ts's myMessages (the last still-
// mock account surface per CLAUDE.md §6.13/§8). One thread per pair of
// users; `listing` is just the context it started from, present only when
// the conversation began from a listing's "Message seller" button.
export interface MessageCounterpart {
  id: string;
  username: string | null;
}

export interface MessageThreadListing {
  id: string;
  title: string;
  game?: Game;
  imageUrl?: string;
}

export interface MessageThreadSummary {
  id: string;
  counterpart: MessageCounterpart;
  listing?: MessageThreadListing;
  // "offer" when the thread's most recent message is a live offer bubble —
  // lets the inbox list render a real "Sent/Received an Offer" pill
  // instead of just its plain-text fallback body.
  lastMessageKind: "text" | "offer";
  lastMessageBody: string;
  lastMessageAt: string;
  lastMessageIsMine: boolean;
  unread: boolean;
}

// The live state of the offer a kind="offer" ChatMessage points at — always
// re-read fresh from the offers table (internal/message.OfferSummary), so
// accepting/declining it from the listing page or Bids/Offers shows up here
// the next time this thread is fetched. buyerId/sellerId (not just "mine"/
// "theirs") are included because a thread is per pair-of-users, not per
// listing — which side of THIS offer the viewer is on can't be inferred
// from who sent the message alone.
export interface ChatMessageOffer {
  id: string;
  listingId: string;
  listingTitle: string;
  listingGame: Game;
  listingImageUrl?: string;
  buyerId: string;
  sellerId: string;
  amountCents: number;
  status: OfferStatus;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  kind: "text" | "offer";
  offer?: ChatMessageOffer;
  createdAt: string;
}

export interface MessageThreadDetail {
  id: string;
  counterpart: MessageCounterpart;
  listing?: MessageThreadListing;
  messages: ChatMessage[];
}

export interface MyThreads {
  threads: MessageThreadSummary[];
  unreadCount: number;
}

// Server-side, explicit accessToken — same shape as getMyNotifications.
// Header fetches this once so AccountMenu/AccountTabs have a real
// server-rendered unread count on first paint (same "no client-only
// initial state" reasoning as everywhere else in this file), and
// account/messages/page.tsx fetches it again for the inbox's initial list.
export async function getMyThreads(accessToken: string): Promise<MyThreads> {
  const res = await fetch(`${API_URL}/me/messages`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load messages: ${res.status}`);
  return res.json();
}

// Client-only refetch — MessagesApp polls this to keep the thread list
// (and unread badges) current while the inbox is open, same distinction
// as getMyNotificationsClient vs getMyNotifications.
export async function getMyThreadsClient(): Promise<MyThreads> {
  return apiFetch("/me/messages");
}

// Server-side initial fetch for a specific conversation — deep-linking to
// /account/messages?thread=<id> renders with real history on first paint
// instead of a loading flash. Also marks the thread read as a side effect
// (see internal/message.GetThreadDetail's doc comment) — opening a
// conversation IS reading it here, there's no separate mark-read click.
export async function getMessageThread(threadId: string, accessToken: string): Promise<MessageThreadDetail> {
  const res = await fetch(`${API_URL}/me/messages/${threadId}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load conversation: ${res.status}`);
  return res.json();
}

// Client-only refetch — polled while a thread is open so new replies show
// up without a page refresh, and called once right after switching threads.
export async function getMessageThreadClient(threadId: string): Promise<MessageThreadDetail> {
  return apiFetch(`/me/messages/${threadId}`);
}

// Finds-or-creates the conversation with recipientId and sends body as its
// next message, atomically (internal/message.StartThreadWithMessage) —
// backs both a brand-new "Message seller" click and reusing an existing
// conversation found via the same recipient. listingId is only recorded
// on first creation of the thread.
export async function startMessageThread(
  recipientId: string,
  body: string,
  listingId?: string,
): Promise<MessageThreadDetail> {
  return apiFetch("/me/messages", {
    method: "POST",
    body: JSON.stringify({ recipientId, body, listingId }),
  });
}

export async function sendMessage(threadId: string, body: string): Promise<ChatMessage> {
  return apiFetch(`/me/messages/${threadId}`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

// Backs the dev panel's "Get a Message" button (DevQuickSwitch) — asks the
// backend to send one real message from some other real user to whoever's
// currently signed in (internal/message.DevSimulateIncoming), so
// MessageBubbleWatcher's own poll picks it up as a genuine incoming
// message rather than the caller faking a bubble client-side.
export async function devSimulateIncomingMessage(): Promise<void> {
  await apiFetch("/me/messages/dev-simulate-incoming", { method: "POST" });
}

// Buys a listing outright — works for a fixed-price listing (its
// price_cents always was the Buy It Now price) or an auction-format
// listing that has a buyItNowPriceCents set, skipping the rest of the
// bidding entirely. Client-only (the button that calls this always renders
// in a Client Component), same reasoning as getMyCelebrations/apiFetch
// above. Real, atomic purchase — not a placeholder — but the response is
// just the updated Listing; there's no order object yet (CLAUDE.md §5.1/§7),
// so the confirmation page it navigates to is deliberately simple.
//
// paymentIntentId is the id from createCheckoutIntent below, once its
// card has been confirmed client-side (MockCheckout) — the backend only
// actually captures/charges it AFTER this call's atomic purchase commits,
// so passing an id here never means money has moved yet. Omit it entirely
// when Stripe isn't configured (apps/api falls back to its original
// no-payment path); the backend itself enforces which is required, not
// this function.
export async function buyNow(listingId: string, paymentIntentId?: string): Promise<Listing> {
  return apiFetch(`/listings/${listingId}/buy-now`, {
    method: "POST",
    body: JSON.stringify(paymentIntentId ? { paymentIntentId } : {}),
  });
}

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

// A linked bank account (internal/paymentmethod.SavedBank) — bankName/
// last4 only, same "never more than a receipt shows" principle as
// SavedCard. Deliberately a distinct type/Stripe object from a seller's
// Connect payout bank account (SellerConnectStatus below): this is a
// buyer's own reusable ACH funding SOURCE for purchases, not anyone's
// payout destination — the two can't be unified even when it's the same
// person's same real-world bank, because Stripe scopes them differently
// (a platform Customer's PaymentMethod vs. a connected account's external
// bank account).
export interface SavedBank {
  id: string;
  bankName: string;
  last4: string;
  isDefault: boolean;
}

export interface CheckoutIntent {
  clientSecret: string;
  paymentIntentId: string;
  rail: "card" | "ach";
  // The amount THIS specific intent charges — matches cardAmountCents or
  // bankAmountCents below depending on rail.
  amountCents: number;
  // Both prices, always present regardless of which rail this intent is
  // for — design doc v2 §2.7: card is always the default/listed price,
  // shown everywhere; bank is only ever offered as a savings choice at
  // checkout, never led with. realizedSavingCents is the buyer's actual
  // total savings choosing bank over card (larger than a naive discount,
  // since a lower goods price also lowers tax) — display this number, not
  // a recomputed difference.
  cardAmountCents: number;
  bankAmountCents: number;
  realizedSavingCents: number;
  sellerFeeCents: number;
  sellerNetCents: number;
  taxCents: number;
  // Identical regardless of rail (only taxCents/amountCents actually vary
  // between card and bank) — lets the checkout page show a real Subtotal +
  // Shipping + Tax = Total breakdown instead of one opaque number, same
  // shape as OrderReceipt.tsx's post-purchase receipt.
  subtotalCents: number;
  shippingCents: number;
  // Whichever saved card/bank actually ended up attached to this intent —
  // whatever MockCheckout.tsx's picker passed as paymentMethodId (below),
  // or the buyer's default if they haven't picked one yet. Never both set
  // (rail decides which is even possible).
  savedCard?: SavedCard;
  savedBank?: SavedBank;
}

// Authorizes a payment for listingId's Buy It Now price on the given rail
// — the first step of the real Stripe checkout flow. Never touches the
// listing itself: this can succeed for multiple buyers on the same
// listing at once, same as two people both being able to load the
// checkout page for it. Called again whenever the buyer switches rails OR
// picks a different saved card/bank in MockCheckout.tsx's picker — lazy
// per-selection creation, not everything up front (design doc v2 §6).
// paymentMethodId is a platform-level SavedCard/SavedBank id (never a raw
// Stripe payment method the buyer hasn't saved) — omit it to fall back to
// their default.
export async function createCheckoutIntent(
  listingId: string,
  rail: "card" | "ach" = "card",
  paymentMethodId?: string,
): Promise<CheckoutIntent> {
  const params = new URLSearchParams({ rail });
  if (paymentMethodId) params.set("paymentMethodId", paymentMethodId);
  return apiFetch(`/listings/${listingId}/checkout-intent?${params}`, { method: "POST" });
}

// Requires auth — same explicit-accessToken shape as getMyBids. Every
// card the caller has saved (internal/paymentmethod), for Account
// Settings' initial render. Empty array (not an error) if they've never
// saved one.
export async function getSavedCards(accessToken: string): Promise<SavedCard[]> {
  const res = await fetch(`${API_URL}/me/payment-methods`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load saved cards: ${res.status}`);
  return res.json();
}

// Client-only refetch after SavedCardsManager mutates its own list (add/
// remove/make-default) — same distinction as getMyNotificationsClient vs
// getMyNotifications.
export async function getSavedCardsClient(): Promise<SavedCard[]> {
  return apiFetch("/me/payment-methods");
}

// Authorizes saving a new card for future reuse, without charging
// anything — backs Account Settings' "Add a card" form and checkout's
// inline "Save Card for future use".
export async function createCardSetupIntent(): Promise<{ clientSecret: string }> {
  return apiFetch("/me/payment-methods/setup-intent", { method: "POST" });
}

export async function setDefaultCard(paymentMethodId: string): Promise<void> {
  await apiFetch(`/me/payment-methods/${paymentMethodId}/default`, { method: "POST" });
}

export async function deleteSavedCard(paymentMethodId: string): Promise<void> {
  await apiFetch(`/me/payment-methods/${paymentMethodId}`, { method: "DELETE" });
}

// --- Saved bank accounts — mirrors the saved-card functions above exactly,
// against the /me/payment-methods/banks routes. ---

export async function getSavedBanks(accessToken: string): Promise<SavedBank[]> {
  const res = await fetch(`${API_URL}/me/payment-methods/banks`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load linked bank accounts: ${res.status}`);
  return res.json();
}

export async function getSavedBanksClient(): Promise<SavedBank[]> {
  return apiFetch("/me/payment-methods/banks");
}

// Authorizes linking a new bank account for future reuse, without
// charging anything — the buyer authenticates with their real bank
// through Stripe's Financial Connections (embedded in the Payment Element
// this client secret drives), the same hosted-login pattern as seller
// Connect onboarding. Backs Account Settings' "Link a bank account" form
// and checkout's inline bank-linking flow.
export async function createBankSetupIntent(): Promise<{ clientSecret: string }> {
  return apiFetch("/me/payment-methods/banks/setup-intent", { method: "POST" });
}

export async function setDefaultBank(paymentMethodId: string): Promise<void> {
  await apiFetch(`/me/payment-methods/banks/${paymentMethodId}/default`, { method: "POST" });
}

export async function deleteSavedBank(paymentMethodId: string): Promise<void> {
  await apiFetch(`/me/payment-methods/banks/${paymentMethodId}`, { method: "DELETE" });
}

// Mirrors apps/api/internal/seller.ConnectAccountStatus exactly. This is a
// seller's Stripe Connect *merchant* identity (who direct charges pay out
// to) — deliberately separate from SavedCard above, which is a buyer's
// saved-card identity. The same person can be both.
export interface SellerConnectStatus {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

// Requires auth. Reports onboarding state without creating anything — a
// seller who's never started onboarding just gets hasAccount: false.
export async function getSellerConnectStatus(accessToken: string): Promise<SellerConnectStatus> {
  const res = await fetch(`${API_URL}/me/seller/connect-account`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load seller payout status: ${res.status}`);
  return res.json();
}

// Client-only refetch after returning from Stripe's hosted onboarding flow.
export async function getSellerConnectStatusClient(): Promise<SellerConnectStatus> {
  return apiFetch("/me/seller/connect-account");
}

// Idempotently ensures a Connect Express account exists, then returns a
// fresh Stripe-hosted onboarding URL to redirect the seller to — "Set up
// payouts" / "Finish setup" in Account Settings, or the same prompt on the
// Sell page. returnPath (must be on the backend's allowlist — see
// apps/api/internal/seller/http.go) is where Stripe sends them back to
// once onboarding completes, so a seller prompted mid-listing-creation
// lands back on /sell instead of always Account Settings.
export async function createSellerOnboardingLink(returnPath?: string): Promise<{ url: string }> {
  await apiFetch("/me/seller/connect-account", { method: "POST" });
  const query = returnPath ? `?returnPath=${encodeURIComponent(returnPath)}` : "";
  return apiFetch(`/me/seller/connect-account/onboarding-link${query}`, { method: "POST" });
}

// Mirrors apps/api/internal/order.State exactly (design doc v2 §5.1).
export type OrderState =
  | "created"
  | "payment_pending"
  | "paid"
  | "awaiting_ship"
  | "shipped"
  | "delivered"
  | "claim_window"
  | "released"
  | "claim_open"
  | "refunded"
  | "cancelled";

// Once shipped, the label is still occasionally needed (reprinting a lost
// copy, referencing it as dispute evidence) but is no longer the primary
// thing on the screen — "ghosted": dim by default, full opacity on
// hover/focus so it's still clickable, not visually competing with
// whatever's actually current. claim_open/claim_window are included since
// a dispute doesn't erase the fact something shipped.
const SHIPPING_LABEL_GHOSTED_STATES: OrderState[] = [
  "shipped",
  "delivered",
  "claim_window",
  "claim_open",
  "released",
];

// Shared visibility rule for ShippingLabelControl, used both by that
// component itself and by server components (the listing detail page)
// that wrap it in their own container and need to know whether to render
// that wrapper at all. Lives here (a plain module, not "use client") so a
// Server Component can call it directly — importing it from
// ShippingLabelControl.tsx used to work for JSX purposes only; calling it
// as a function from a Server Component isn't valid for a "use client"
// module's export.
export function isShippingLabelVisible(state: OrderState, hasLabel: boolean): boolean {
  const ghosted = SHIPPING_LABEL_GHOSTED_STATES.includes(state);
  if (state !== "awaiting_ship" && !ghosted) return false;
  if (ghosted && !hasLabel) return false;
  return true;
}

// Mirrors apps/api/internal/order.Order exactly. Only exists for a purchase
// made through the real Connect checkout path (Phase 3 onward) — a mock
// purchase has no order at all.
export interface Order {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  state: OrderState;
  rail?: "card" | "ach";
  tierAtSale: string;
  // The seller's actual commission rate at sale time (e.g. 0.063 for
  // 6.3%) — a permanent snapshot (design doc v2 §10), never re-derived
  // from tierAtSale later, since a Hous Trust seller's rate is
  // individually negotiated and every tier's own rate can change going
  // forward without rewriting past orders.
  tierPctAtSale: number;
  subtotalCents: number;
  shippingCents: number;
  sellerFeeCents: number;
  sellerNetCents: number;
  // Always 0 on the card rail — only ever nonzero for an ACH-rail order,
  // subtracted from subtotalCents on the buyer's side (never from
  // sellerNetCents, which never depends on which rail the buyer chose).
  // Needed so a receipt's "what your buyer paid" line items actually sum
  // to chargedCents on both rails.
  discountCents: number;
  taxCents: number;
  chargedCents: number;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
  deliveredAt?: string;
  claimDeadline?: string;
  releasedAt?: string;
  createdAt: string;
  // Snapshotted at sale time (apps/api/internal/order.CreateFromWin) —
  // whichever of the listing's chosen preset and the price-driven floor
  // (internal/shipping.RequiredMechanism) is stricter. Absent on orders
  // created before this feature existed.
  shippingPreset?: ShippingPreset;
  signatureRequired: boolean;
  labelCostCents?: number;
  labelUrl?: string;
}

// Mirrors apps/api/internal/order.Summary exactly — the Transactions tab's
// one row shape, an Order plus exactly the denormalized fields that list
// needs (listing title/photo, the other party's username) so it never has
// to N+1-fetch every listing just to render a list of orders.
export interface OrderSummary extends Order {
  listingTitle: string;
  listingImageUrl?: string;
  counterpartyId: string;
  counterpartyUsername?: string;
  // Both sides' usernames, unconditional on viewer perspective — the
  // Transactions list's stepper always shows Seller on one end and Buyer
  // on the other, so it needs both, not just "the other one."
  sellerUsername?: string;
  buyerUsername?: string;
  viewerIsSeller: boolean;
}

// Every order the caller is a participant in, buyer or seller side,
// newest first — backs the Transactions tab (account/transactions), which
// merges what used to only be visible split across Sold History/Buy
// History (no state) and the one-off post-checkout order-status page (no
// persistent list). Requires auth — same explicit-accessToken shape as
// getMyBids/getMySales.
export async function getMyOrders(accessToken: string): Promise<OrderSummary[]> {
  const res = await fetch(`${API_URL}/me/orders`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load orders: ${res.status}`);
  return res.json();
}

// Same /me/orders data as getMyOrders, but for Client Components (the
// Support claim-start picker) — apiFetch attaches the current session's
// token itself, so there's no accessToken to thread down as a prop.
export async function getMyOrdersMine(): Promise<OrderSummary[]> {
  return apiFetch("/me/orders");
}

// Mirrors apps/api/internal/order.EvidenceType exactly.
export type EvidenceType =
  | "card_front"
  | "card_back"
  | "package_sealed"
  | "arrival_photo"
  | "claim_photo";

// The order tied to a listing (backs the order-status page), visible only
// to that order's own buyer or seller. Requires auth — same explicit-
// accessToken shape as getMyAddress/getSavedCards, since the order page
// fetches this server-side. Throws (via ApiError, status 404) if this
// listing was never paid for through the real Connect checkout path.
export async function getOrderForListing(listingId: string, accessToken: string): Promise<Order> {
  const res = await fetch(`${API_URL}/listings/${listingId}/order`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `Failed to load order: ${res.status}`, res.status);
  }
  return res.json();
}

// Mirrors apps/api/internal/shipping.TrackingLocation — a checkpoint's
// facility/region, never a full mailing address.
export interface TrackingLocation {
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

// Mirrors apps/api/internal/shipping.TrackingCheckpoint exactly.
export interface TrackingCheckpoint {
  status: string;
  statusDetails: string;
  location?: TrackingLocation;
  occurredAt: string;
}

// Mirrors apps/api/internal/shipping.TrackingInfo — the whole tracking
// page's data, checkpoints newest first (already sorted server-side).
export interface TrackingInfo {
  carrier: string;
  trackingNumber: string;
  status: string;
  statusDetails: string;
  eta?: string;
  checkpoints: TrackingCheckpoint[];
}

// Backs the Shipped step's dedicated tracking page
// (app/order/[id]/tracking) — a real carrier lookup (Shippo's public
// track-a-shipment API), not a re-derivation of shippedAt/deliveredAt.
// Same explicit-accessToken shape as getOrderForListing, since the page
// fetches server-side. Throws (via ApiError) with a 404 if no tracking
// number has been recorded yet, or a 503 if tracking isn't configured.
export async function getOrderTracking(listingId: string, accessToken: string): Promise<TrackingInfo> {
  const res = await fetch(`${API_URL}/listings/${listingId}/order/tracking`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `Failed to load tracking: ${res.status}`, res.status);
  }
  return res.json();
}

// Records one evidence photo after it's already been uploaded client-side
// to Supabase Storage (lib/storage.ts's uploadOrderEvidence) — this call
// only ever sends the resulting URL, never the file itself.
export async function addOrderEvidence(
  listingId: string,
  type: EvidenceType,
  url: string,
): Promise<void> {
  await apiFetch(`/listings/${listingId}/order/evidence`, {
    method: "POST",
    body: JSON.stringify({ type, url }),
  });
}

// Result of a real Shippo label purchase — mirrors apps/api/internal/
// shipping's buyLabelResponse exactly.
export interface ShippingLabel {
  trackingNumber: string;
  carrier: string;
  service: string;
  labelUrl: string;
  costCents: number;
}

// Hydrates a ShippingLabel straight from whatever's already persisted on an
// Order (order.labelUrl/trackingNumber/carrier/labelCostCents) — the same
// shape ShippingLabelControl needs whether it's rendering on the order
// page, the listing page, or a Transactions row, all fresh page loads with
// no "just bought it this session" event to react to. Null when no label
// has ever been purchased for this order.
export function labelFromOrder(order: Order): ShippingLabel | null {
  if (!order.labelUrl || !order.trackingNumber || !order.carrier) return null;
  return {
    trackingNumber: order.trackingNumber,
    carrier: order.carrier,
    service: "",
    labelUrl: order.labelUrl,
    costCents: order.labelCostCents ?? 0,
  };
}

// The seller's "buy a shipping label" action — dispatches server-side to
// Shippo or Pitney Bowes depending on whichever preset the order
// snapshotted (see Order.shippingPreset), using both parties' saved
// addresses (Account Settings) unless fromAddressOverride is given, in
// which case that stands in for the seller's own account address for this
// one label only (never persisted back to Account Settings — see
// PrintLabelButton's "Change Shipping Label" flow, which always prefills
// its edit form from GET /me/address first). The buyer's own address is
// never overridable here — this only ever changes whose return address a
// package ships from, not where it's going. 400 if either address is
// missing/invalid, 409 if the order has already shipped (a label can only
// be bought or changed up through awaiting_ship), 503 if the vendor that
// preset needs isn't configured on the backend. Only records the result on
// the order — still requires a follow-up shipOrder call (or the caller can
// pass the returned carrier/trackingNumber straight through) to actually
// transition the order to shipped.
export async function buyShippingLabel(
  listingId: string,
  fromAddressOverride?: Address,
): Promise<ShippingLabel> {
  return apiFetch(`/listings/${listingId}/order/shipping-label`, {
    method: "POST",
    body: JSON.stringify({ fromAddressOverride: fromAddressOverride ?? null }),
  });
}

export interface AddressVerification {
  valid: boolean;
  // True when Pitney Bowes' real USPS lookup normalized something (a
  // fixed ZIP+4, an expanded abbreviation) — worth showing the caller the
  // corrected fields before they commit to buying with them, since a
  // tracked_envelope label is non-refundable once purchased (see
  // internal/shipping.BuyLabel's own doc comment).
  corrected: boolean;
  normalized?: Address;
  errorReason?: string;
}

// Checks an address against USPS's real database (the same check a label
// purchase itself performs) BEFORE spending a non-refundable
// tracked_envelope label purchase on finding out it was wrong — added
// after a real "E412 - the delivery information does not match data for
// this city" error surfaced only as a raw backend error message on
// PrintLabelButton's "Change Shipping Label" form. Not scoped to a
// specific order/listing, so AddressForm.tsx (Account Settings) can call
// this too, not just the shipping-label override flow.
export async function verifyShippingAddress(
  a: Pick<Address, "line1" | "line2" | "city" | "state" | "postalCode" | "country">,
): Promise<AddressVerification> {
  return apiFetch("/shipping/verify-address", {
    method: "POST",
    body: JSON.stringify(a),
  });
}

export interface AddressSuggestion {
  placeId: string;
  text: string;
}

export type ResolvedAddress = Pick<Address, "line1" | "city" | "state" | "postalCode" | "country">;

// As-you-type address suggestions (internal/address.AutocompleteClient,
// Google Places under the hood) — added alongside verifyShippingAddress
// above for the same reason: a free-text address field lets through
// typos/format mismatches (wrong city/ZIP pairing, "USA" instead of "US")
// that read fine to a person but fail Pitney Bowes' stricter USPS-backed
// validation. Picking a real suggestion here means the fields Resolve
// fills in already came from a real, USPS-known address. Returns an empty
// list (never throws) on any failure, including the backend not having
// GOOGLE_PLACES_API_KEY configured at all — callers should treat "no
// suggestions" as "fall back to typing it by hand," not an error state.
export async function autocompleteAddress(query: string): Promise<AddressSuggestion[]> {
  if (!query.trim()) return [];
  try {
    const { suggestions } = await apiFetch(`/address/autocomplete?q=${encodeURIComponent(query)}`);
    return suggestions ?? [];
  } catch {
    return [];
  }
}

// Turns a suggestion the caller picked into the address fields to autofill
// the rest of the form with (everything Places can know — never fullName
// or phone).
export async function resolveAddressSuggestion(placeId: string): Promise<ResolvedAddress> {
  return apiFetch(`/address/autocomplete/resolve?placeId=${encodeURIComponent(placeId)}`);
}

// Triggers a real file download of the order's already-purchased label PDF
// — deliberately NOT a plain <a href={label.labelUrl}>: that URL points at
// Shippo's CDN, a different origin, and browsers silently ignore the
// `download` attribute on cross-origin links, so a plain link just opens
// the PDF viewer instead of downloading. Fetching the bytes here (through
// our own backend's proxy endpoint, which replies with Content-Disposition:
// attachment) and handing them to the browser as a same-origin blob URL is
// what actually forces a download.
export async function downloadShippingLabel(listingId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${API_URL}/listings/${listingId}/order/shipping-label/download`, {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `Failed to download label: ${res.status}`, res.status);
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = "shipping-label.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

// The seller's "mark as shipped" action — rejected (409) until the
// required photo evidence (card front/back, sealed package) is already on
// file, per design doc v2 §5.3.
export async function shipOrder(
  listingId: string,
  carrier: string,
  trackingNumber: string,
): Promise<Order> {
  return apiFetch(`/listings/${listingId}/order/ship`, {
    method: "POST",
    body: JSON.stringify({ carrier, trackingNumber }),
  });
}

// Dev-only "advance" button (Transactions list, TransactionStepper) — pushes
// the order exactly one step through the real shipping/delivery/claim-window
// flow, bypassing the 72-hour ship clock, a real carrier scan, and the 3/7-day
// claim window. There's no way to actually ship a physical card in dev, so
// this is the stand-in for "the seller shipped it, the carrier delivered
// it, the claim window elapsed." The backend refuses to run this outside
// development regardless of whether the button is reachable at all
// (order.AllowDevAdvance) — see apps/api/internal/order/devadvance.go.
export async function devAdvanceOrder(listingId: string): Promise<Order> {
  return apiFetch(`/listings/${listingId}/order/dev-advance`, { method: "POST" });
}

// Mirrors apps/api/internal/dispute exactly (design doc v2 §9).
export type ClaimState =
  | "opened"
  | "negotiating"
  | "escalated"
  | "auto_adjudicated"
  | "human_review"
  | "decided"
  | "appealed"
  | "closed";

export type ClaimReasonCode =
  | "not_as_described"
  | "not_received_no_tracking"
  | "not_received_tracking_delivered"
  | "payment_fraud"
  | "buyers_remorse"
  | "transit_damage";

export type ClaimResolution = "refund_buyer" | "deny" | "partial_refund" | "platform_absorb";
export type ClaimLiableParty = "seller" | "buyer" | "platform";

export interface Claim {
  id: string;
  // "CLM-000123" — the human-facing ticket number shown throughout the
  // claim UI, distinct from the internal uuid id.
  ticketNumber: string;
  orderId: string;
  openedBy: string;
  reasonCode: ClaimReasonCode;
  state: ClaimState;
  resolution?: ClaimResolution;
  refundCents?: number;
  liableParty?: ClaimLiableParty;
  reviewerId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export type ClaimEventKind =
  | "message"
  | "evidence"
  | "partial_refund_offer"
  | "escalation"
  | "decision"
  | "appeal";

export interface ClaimEvent {
  id: string;
  claimId: string;
  actorId: string;
  kind: ClaimEventKind;
  body?: string;
  amountCents?: number;
  createdAt: string;
}

export interface ClaimDetail {
  claim: Claim;
  events: ClaimEvent[];
}

// Whether this listing's order already has a claim — 404 (via ApiError,
// caught by callers) means no claim exists yet, the common case.
export async function getClaimForListing(listingId: string): Promise<ClaimDetail> {
  return apiFetch(`/listings/${listingId}/order/claim`);
}

export async function getClaim(claimId: string): Promise<ClaimDetail> {
  return apiFetch(`/claims/${claimId}`);
}

export async function openClaim(
  orderId: string,
  reasonCode: ClaimReasonCode,
  body: string,
): Promise<Claim> {
  return apiFetch("/claims", {
    method: "POST",
    body: JSON.stringify({ orderId, reasonCode, body }),
  });
}

export async function addClaimMessage(claimId: string, body: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/messages`, { method: "POST", body: JSON.stringify({ body }) });
}

export async function addClaimEvidence(claimId: string, url: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/evidence`, { method: "POST", body: JSON.stringify({ url }) });
}

export async function resolveClaimByAgreement(claimId: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/resolve`, { method: "POST" });
}

export async function proposePartialRefund(claimId: string, amountCents: number): Promise<void> {
  await apiFetch(`/claims/${claimId}/partial-refund-offer`, {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}

export async function acceptPartialRefund(claimId: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/partial-refund-accept`, { method: "POST" });
}

export async function escalateClaim(claimId: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/escalate`, { method: "POST" });
}

export async function appealClaim(claimId: string, body: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/appeal`, { method: "POST", body: JSON.stringify({ body }) });
}

// --- Admin claims queue (the Workers side's first page) ---
//
// Mirrors apps/api/internal/dispute.AdminClaimSummary exactly — a Claim
// plus exactly the order/listing/participant context the queue and detail
// screens need, denormalized so neither view has to N+1-fetch the order.
export interface AdminClaimSummary extends Claim {
  orderState: OrderState;
  chargedCents: number;
  listingId: string;
  listingTitle: string;
  buyerUsername: string;
  sellerUsername: string;
}

export interface AdminClaimDetail {
  claim: AdminClaimSummary;
  events: ClaimEvent[];
}

// Admin-only (server enforces via the same email allowlist as
// getAdminMetrics). stateFilter narrows the queue to one state — pass
// "human_review" for "needs a decision," omit for full history.
export async function getAdminClaims(
  accessToken: string,
  stateFilter?: ClaimState,
): Promise<AdminClaimSummary[]> {
  const qs = stateFilter ? `?state=${stateFilter}` : "";
  const res = await fetch(`${API_URL}/admin/claims${qs}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

export async function getAdminClaim(claimId: string, accessToken: string): Promise<AdminClaimDetail> {
  const res = await fetch(`${API_URL}/admin/claims/${claimId}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

export interface DecideClaimInput {
  resolution: ClaimResolution;
  liableParty: ClaimLiableParty;
  refundCents: number;
}

// decideClaim backs a claim in human_review; decideClaimAppeal backs one in
// appealed (design doc v2 §9.1's "one appeal, different reviewer, final") —
// two endpoints because the state machine only allows each transition from
// its own state (apps/api/internal/dispute/dispute.go's transitions table).
export async function decideClaim(claimId: string, input: DecideClaimInput): Promise<void> {
  await apiFetch(`/claims/${claimId}/decide`, { method: "POST", body: JSON.stringify(input) });
}

export async function decideClaimAppeal(claimId: string, input: DecideClaimInput): Promise<void> {
  await apiFetch(`/claims/${claimId}/decide-appeal`, { method: "POST", body: JSON.stringify(input) });
}

// Design doc v2 §6.3's paid instant-payout upsell — pays out everything
// currently released for the caller right now, at the 2% instant price,
// landing in ~30 minutes instead of Standard's ~1-2 business days.
export async function triggerInstantPayout(): Promise<{ payoutId?: string; triggered: boolean }> {
  return apiFetch("/me/payout/instant", { method: "POST" });
}

// The free path — Stripe's ordinary ~1-2 business day payout speed. One
// of these two calls (this or triggerInstantPayout) is the ONLY way money
// ever leaves a seller's Stripe balance on this platform — there is no
// automatic background payout, deliberately (see apps/api/cmd/worker/
// main.go's doc comment for why an earlier automatic version was removed).
export async function triggerStandardPayout(): Promise<{ payoutId?: string; triggered: boolean }> {
  return apiFetch("/me/payout/standard", { method: "POST" });
}

// Mirrors apps/api/internal/payout.Record exactly.
export interface PayoutRecord {
  id: string;
  amountCents: number;
  status: "pending" | "in_transit" | "paid" | "failed";
  kind: "standard" | "batched" | "per_order" | "instant";
  createdAt: string;
  paidAt?: string;
}

// Mirrors apps/api/internal/payout's HandleSummary response exactly — the
// Withdraw page's wallet balance (availableCents, what a "Withdraw now"
// click actually sends), the greyed-out "still on hold" figure next to it
// (pendingCents — orders still inside their claim window, design doc v2
// §5.2), and recent payout history in one round trip.
export interface PayoutSummary {
  availableCents: number;
  pendingCents: number;
  recent: PayoutRecord[];
}

export async function getPayoutSummary(accessToken: string): Promise<PayoutSummary> {
  const res = await fetch(`${API_URL}/me/payout/summary`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to load payout summary: ${res.status}`);
  return res.json();
}

export async function getPayoutSummaryClient(): Promise<PayoutSummary> {
  return apiFetch("/me/payout/summary");
}

// Mirrors apps/api/internal/metrics.Snapshot exactly (design doc v2 §11).
export interface AdminMetrics {
  totalOrders: number;
  achMixPct: number;
  ordersPerActiveSellerLast30d: number;
  railMix: { rail: string; orderCount: number; gmvCents: number }[];
  tierGmv: { tier: string; orderCount: number; gmvCents: number }[];
  marginByTierRail: { tier: string; rail: string; orderCount: number; marginCents: number }[];
  disputeRateByTier: { tier: string; orderCount: number; claimCount: number; ratePct: number }[];
  achReturnRatePct: number;
  avgHoursPurchaseToPayout?: number;
}

// Admin-only (server enforces via an email allowlist) — the internal
// reporting snapshot design doc v2 §11 calls for.
export async function getAdminMetrics(accessToken: string): Promise<AdminMetrics> {
  const res = await fetch(`${API_URL}/admin/metrics`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

// Sell wizard's QR "upload from your phone" handoff (PhoneUploadPanel). The
// desktop side is authenticated as usual; the phone side (below) is
// deliberately not — see apps/api/internal/photosession's package doc.
export interface PhotoUploadSession {
  id: string;
  expiresAt: string;
}

export async function createPhotoUploadSession(): Promise<PhotoUploadSession> {
  return apiFetch("/photo-sessions", { method: "POST" });
}

export async function getPhotoUploadSessionPhotosClient(sessionId: string): Promise<string[]> {
  const data = await apiFetch(`/photo-sessions/${sessionId}/photos`);
  return data.photoUrls;
}

// The two functions below back the phone-side page
// (app/sell/phone-upload/[sessionId]) and deliberately do NOT use apiFetch —
// there's no logged-in session on the phone, and apiFetch would force a
// Content-Type: application/json header that breaks uploadPhotoToSession's
// multipart boundary anyway.
export async function getPhotoUploadSessionStatus(
  sessionId: string,
): Promise<{ expired: boolean; photoCount: number }> {
  const res = await fetch(apiUrl(`/photo-sessions/${sessionId}`), { cache: "no-store" });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  return res.json();
}

export async function uploadPhotoToSession(sessionId: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("photo", file);
  const res = await fetch(apiUrl(`/photo-sessions/${sessionId}/photos`), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new ApiError(await res.text(), res.status);
  const data = await res.json();
  return data.url;
}

// --- Seller tier ---

// Mirrors apps/api/internal/seller.MyTierStatus exactly.
export interface MyTierStatus {
  tier: SellerTier;
  tierPct: number;
  cumulativeOrders: number;
  disputeRate90d: number;
  reviewCount: number;
  averageRating: number;
}

export async function getMyTier(): Promise<MyTierStatus> {
  return apiFetch("/me/seller/tier");
}

// Platinum-only — apps/api/internal/seller.ApplyForHousTrust enforces the
// real eligibility bar server-side; this just calls it.
export async function applyForHousTrust(): Promise<{ applicationId: string }> {
  return apiFetch("/me/seller/hous-trust/apply", { method: "POST" });
}

// Dev-only — apps/api/internal/seller.DevAdjustTier refuses to run outside
// development regardless of whether this is called; see DevQuickSwitch.tsx.
export async function devAdjustTier(direction: "up" | "down"): Promise<{ tier: SellerTier }> {
  return apiFetch("/me/seller/dev-tier-adjust", {
    method: "POST",
    body: JSON.stringify({ direction }),
  });
}
