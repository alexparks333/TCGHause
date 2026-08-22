import { supabase } from './supabase';
import type {
  Claim,
  ClaimDetail,
  ClaimReasonCode,
  EvidenceType,
  Listing,
  Me,
  MyBid,
  Order,
  OrderSummary,
  PublicUser,
} from './types';

// Expo env vars need the EXPO_PUBLIC_ prefix to be inlined into the client
// bundle (Expo's equivalent of Next's NEXT_PUBLIC_ convention). Must be a
// LAN IP (not localhost) when running on a physical phone via Expo Go —
// localhost from the phone's perspective is the phone itself. See
// apps/mobile/.env.example.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';

// Mirrors apps/web/lib/api.ts's ApiError exactly — a plain Error subclass
// carrying the HTTP status, so callers that need to tell "already sold"
// (409) apart from "can't buy your own listing" (403) or "seller hasn't
// finished payout setup" (412) can do so without parsing error text. Added
// for checkout (src/app/checkout/[id].tsx) — nothing before it needed
// status-code-aware error handling.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

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
    throw new ApiError(text || `Request failed: ${res.status}`, res.status);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Mirrors apps/web/lib/api.ts's ListingFilters exactly (same backend,
// apps/api/internal/listing.ListFilters) — the fields FilterSidebar drives
// beyond game/search.
export interface ListingFilters {
  game?: string;
  search?: string;
  sellerId?: string;
  sold?: boolean;
  fixedOnly?: boolean;
  priceMinCents?: number;
  priceMaxCents?: number;
  conditionMin?: string;
  timeLeftMinHours?: number;
  timeLeftMaxHours?: number;
}

export async function getActiveListings(filters: ListingFilters = {}): Promise<Listing[]> {
  const params = new URLSearchParams();
  if (filters.game) params.set('game', filters.game);
  if (filters.search) params.set('q', filters.search);
  if (filters.sellerId) params.set('seller_id', filters.sellerId);
  if (filters.sold) params.set('sold', 'true');
  if (filters.fixedOnly) params.set('fixedOnly', 'true');
  if (filters.priceMinCents !== undefined) params.set('priceMin', String(filters.priceMinCents));
  if (filters.priceMaxCents !== undefined) params.set('priceMax', String(filters.priceMaxCents));
  if (filters.conditionMin) params.set('conditionMin', filters.conditionMin);
  if (filters.timeLeftMinHours !== undefined) params.set('timeLeftMin', String(filters.timeLeftMinHours));
  if (filters.timeLeftMaxHours !== undefined) params.set('timeLeftMax', String(filters.timeLeftMaxHours));
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

// The real data behind Buy History — every listing this account has
// bought, whether paid for yet or not. Mirrors apps/web/lib/api.ts's
// getMyPurchases exactly (same endpoint, same shape).
export async function getMyPurchases(): Promise<Listing[]> {
  return apiFetch('/me/purchases');
}

// The real data behind Sold History — every listing this seller has sold,
// whether paid out yet or not. Mirrors apps/web/lib/api.ts's getMySales
// exactly (same endpoint, same shape).
export async function getMySales(): Promise<Listing[]> {
  return apiFetch('/me/sales');
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

// Mirrors apps/api/internal/feedback.Review / apps/web/lib/api.ts's Review
// exactly (CLAUDE.md §6.3) — three rating axes, not one blended score;
// overallRating is derived server-side (mean of the three), never stored.
// Previously had a single `rating` field that didn't exist anywhere in the
// real API response, so every review rendered with an undefined (empty)
// star count regardless of its actual rating — fixed by matching the real
// shape instead of a guessed one.
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

// Powers the seller profile screen (app/seller/[username].tsx) — mirrors
// apps/web/lib/api.ts's getUserByUsername exactly (same public, no-auth Go
// endpoint; never the raw User row with an email on it).
export async function getUserByUsername(username: string): Promise<PublicUser | null> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load user: ${res.status}`);
  return res.json();
}

export async function getSellerReviews(username: string): Promise<ReviewSummary> {
  const res = await fetch(`${API_URL}/users/${encodeURIComponent(username)}/reviews`);
  if (!res.ok) throw new Error(`Failed to load reviews: ${res.status}`);
  return res.json();
}

export interface ReviewableListing {
  listingId: string;
  title: string;
  endedAt: string;
}

// Mirrors apps/web/lib/api.ts's getReviewablePurchases exactly. Every
// entry is a purchase from this seller the caller hasn't reviewed yet —
// used by the order detail screen to decide whether this specific
// listingId is still eligible for a review, rather than only finding out
// via a 403 after submitting.
export async function getReviewablePurchases(username: string): Promise<ReviewableListing[]> {
  try {
    const data = await apiFetch(`/users/${encodeURIComponent(username)}/reviewable-purchases`);
    return data.listings ?? [];
  } catch {
    return [];
  }
}

export interface SubmitReviewInput {
  listingId: string;
  conditionAccuracy: number;
  shippingSpeed: number;
  trustworthiness: number;
  comment?: string;
}

// Mirrors ReviewForm.tsx's submit call (POST /users/{username}/reviews) —
// one review per (reviewer, listing) pair; re-submitting for the same
// listing replaces it (internal/feedback.Upsert).
export async function submitReview(username: string, input: SubmitReviewInput): Promise<void> {
  await apiFetch(`/users/${encodeURIComponent(username)}/reviews`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// --- Messaging (app/messages/) — mirrors apps/web/lib/api.ts's message
// section exactly (same four endpoints, same shapes). Web has a server-
// fetch/client-fetch split (getMyThreads vs getMyThreadsClient) because it
// has SSR; mobile has no SSR and always has a session, so one function per
// endpoint through apiFetch is enough. ---

export interface MessageCounterpart {
  id: string;
  username: string | null;
}

export interface MessageThreadListing {
  id: string;
  title: string;
  imageUrl?: string;
}

export interface MessageThreadSummary {
  id: string;
  counterpart: MessageCounterpart;
  listing?: MessageThreadListing;
  lastMessageBody: string;
  lastMessageAt: string;
  lastMessageIsMine: boolean;
  unread: boolean;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
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

export async function getMyThreads(): Promise<MyThreads> {
  return apiFetch('/me/messages');
}

// Marks the thread read as a side effect, server-side — there's no
// separate "mark read" endpoint, opening a thread IS reading it.
export async function getMessageThread(threadId: string): Promise<MessageThreadDetail> {
  return apiFetch(`/me/messages/${threadId}`);
}

// Finds-or-creates the (unordered-pair) thread with recipientId and sends
// body as its first (or next) message, atomically — the backing call for
// MessageSellerButton. listingId is only ever recorded on a thread's first
// creation, not on later calls into an already-existing thread.
export async function startMessageThread(
  recipientId: string,
  body: string,
  listingId?: string,
): Promise<MessageThreadDetail> {
  return apiFetch('/me/messages', {
    method: 'POST',
    body: JSON.stringify({ recipientId, body, ...(listingId ? { listingId } : {}) }),
  });
}

// Replies to an already-open thread — distinct from startMessageThread
// (POST /me/messages vs POST /me/messages/{id}), same split as the Go API.
export async function sendMessage(threadId: string, body: string): Promise<ChatMessage> {
  return apiFetch(`/me/messages/${threadId}`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

// --- Notifications (top-right bell) — mirrors apps/web/lib/api.ts's
// notification section exactly (same three endpoints, same shapes).
// Mobile has no SSR (see the messaging section above for why), so there's
// just one fetch function instead of web's server/client split. ---

export interface AppNotification {
  id: string;
  kind: 'won' | 'sold' | 'outbid' | 'bought';
  listingId: string;
  listingTitle: string;
  listingImageUrl?: string;
  readAt: string | null;
  createdAt: string;
}

export interface MyNotifications {
  notifications: AppNotification[];
  unreadCount: number;
}

export async function getMyNotifications(): Promise<MyNotifications> {
  return apiFetch('/me/notifications');
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch(`/me/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch('/me/notifications/read-all', { method: 'POST' });
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

// --- Seller payouts — mirrors apps/web/lib/api.ts's SellerConnectStatus/
// PayoutSummary section exactly (same endpoints, same shapes) ---

// Mirrors apps/api/internal/seller.ConnectAccountStatus exactly.
export interface SellerConnectStatus {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export async function getSellerConnectStatus(): Promise<SellerConnectStatus> {
  return apiFetch('/me/seller/connect-account');
}

// Idempotently ensures a Connect Express account exists, then returns a
// fresh Stripe-hosted onboarding URL. Unlike apps/web (which redirects the
// whole page there and Stripe sends the browser back to a page on this same
// site), there's no mobile deep-link back destination wired up on the
// backend yet (apps/api/internal/seller/http.go's returnPath allowlist only
// has web paths) — Stripe returns the user to the WEB app, not back into
// this app, after they finish in the system browser. Good enough for now:
// they finish onboarding, see confirmation on the web page, then switch
// back to the app, where a pull-to-refresh picks up the new status.
export async function createSellerOnboardingLink(): Promise<{ url: string }> {
  await apiFetch('/me/seller/connect-account', { method: 'POST' });
  return apiFetch('/me/seller/connect-account/onboarding-link', { method: 'POST' });
}

// Mirrors apps/api/internal/payout.Record exactly.
export interface PayoutRecord {
  id: string;
  amountCents: number;
  status: 'pending' | 'in_transit' | 'paid' | 'failed';
  kind: 'standard' | 'batched' | 'per_order' | 'instant';
  createdAt: string;
  paidAt?: string;
}

// Mirrors apps/api/internal/payout's HandleSummary response exactly.
export interface PayoutSummary {
  availableCents: number;
  pendingCents: number;
  recent: PayoutRecord[];
}

export async function getPayoutSummary(): Promise<PayoutSummary> {
  return apiFetch('/me/payout/summary');
}

// The free path — Stripe's ordinary ~1-2 business day payout speed. One of
// these two calls (this or triggerInstantPayout) is the ONLY way money ever
// leaves a seller's Stripe balance on this platform — no automatic
// background payout exists.
export async function triggerStandardPayout(): Promise<{ payoutId?: string; triggered: boolean }> {
  return apiFetch('/me/payout/standard', { method: 'POST' });
}

// The paid instant-payout upsell — pays out everything currently released
// right now, at the 2% instant price, landing in ~30 minutes instead of
// Standard's ~1-2 business days.
export async function triggerInstantPayout(): Promise<{ payoutId?: string; triggered: boolean }> {
  return apiFetch('/me/payout/instant', { method: 'POST' });
}

// --- Checkout (src/app/checkout/[id].tsx) — mirrors apps/web/lib/api.ts's
// CheckoutIntent/createCheckoutIntent/buyNow exactly, scoped to only the
// fields/params mobile v1 actually uses: card rail only (no ach), no saved
// payment method picker (backend supports one, mobile doesn't build the UI
// for it yet). ---

export interface CheckoutIntent {
  clientSecret: string;
  paymentIntentId: string;
  amountCents: number;
}

// Authorizes a payment for listingId's price (Buy It Now, or a won auction
// — the backend derives which server-side, see checkout/[id].tsx's doc
// comment) on the card rail. Never touches the listing itself — this can
// succeed for multiple buyers on the same listing at once, same as two
// people both being able to load the checkout screen for it; only buyNow's
// atomic purchase below decides a winner.
export async function createCheckoutIntent(listingId: string): Promise<CheckoutIntent> {
  return apiFetch(`/listings/${listingId}/checkout-intent?rail=card`, { method: 'POST' });
}

// paymentIntentId is the id from createCheckoutIntent, once its card has
// been confirmed client-side (PaymentSheet) — the backend only actually
// captures/charges it AFTER this call's atomic purchase commits, so calling
// this never means money has moved yet by itself.
export async function buyNow(listingId: string, paymentIntentId: string): Promise<Listing> {
  return apiFetch(`/listings/${listingId}/buy-now`, {
    method: 'POST',
    body: JSON.stringify({ paymentIntentId }),
  });
}

// --- Orders / Transactions (src/app/transactions.tsx, src/app/order/[id].tsx)
// — mirrors apps/web/lib/api.ts's order + claim section exactly. ---

// Every order the caller is a participant in, buyer or seller side,
// newest first — backs the Transactions tab.
export async function getMyOrders(): Promise<OrderSummary[]> {
  return apiFetch('/me/orders');
}

// The order tied to a listing (backs the order detail screen), visible
// only to that order's own buyer or seller. Throws (ApiError, 404) if this
// listing was never paid for through the real Connect checkout path.
export async function getOrderForListing(listingId: string): Promise<Order> {
  return apiFetch(`/listings/${listingId}/order`);
}

// Records one evidence photo after it's already been uploaded client-side
// to Supabase Storage (lib/storage.ts's uploadOrderEvidence) — this call
// only ever sends the resulting URL, never the file itself.
export async function addOrderEvidence(listingId: string, type: EvidenceType, url: string): Promise<void> {
  await apiFetch(`/listings/${listingId}/order/evidence`, {
    method: 'POST',
    body: JSON.stringify({ type, url }),
  });
}

// The seller's "mark as shipped" action — rejected (409) until the
// required photo evidence (card front/back, sealed package) is already on
// file, per design doc v2 §5.3.
export async function shipOrder(listingId: string, carrier: string, trackingNumber: string): Promise<Order> {
  return apiFetch(`/listings/${listingId}/order/ship`, {
    method: 'POST',
    body: JSON.stringify({ carrier, trackingNumber }),
  });
}

// Whether this listing's order already has a claim — 404 (via ApiError,
// caught by callers) means no claim exists yet, the common case.
export async function getClaimForListing(listingId: string): Promise<ClaimDetail> {
  return apiFetch(`/listings/${listingId}/order/claim`);
}

export async function openClaim(orderId: string, reasonCode: ClaimReasonCode, body: string): Promise<Claim> {
  return apiFetch('/claims', {
    method: 'POST',
    body: JSON.stringify({ orderId, reasonCode, body }),
  });
}

export async function addClaimMessage(claimId: string, body: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
}

export async function addClaimEvidence(claimId: string, url: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/evidence`, { method: 'POST', body: JSON.stringify({ url }) });
}

export async function proposePartialRefund(claimId: string, amountCents: number): Promise<void> {
  await apiFetch(`/claims/${claimId}/partial-refund-offer`, {
    method: 'POST',
    body: JSON.stringify({ amountCents }),
  });
}

export async function acceptPartialRefund(claimId: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/partial-refund-accept`, { method: 'POST' });
}

export async function resolveClaimByAgreement(claimId: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/resolve`, { method: 'POST' });
}

export async function escalateClaim(claimId: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/escalate`, { method: 'POST' });
}

export async function appealClaim(claimId: string, body: string): Promise<void> {
  await apiFetch(`/claims/${claimId}/appeal`, { method: 'POST', body: JSON.stringify({ body }) });
}
