// Mirrors apps/web/lib/types.ts exactly — same backend, same JSON shape
// (apps/api/internal/listing.Listing). Keep these two files in sync by
// hand until packages/shared-contracts actually generates both (it
// doesn't yet — see that package's README).

export type Game =
  | 'Pokémon'
  | 'Magic: The Gathering'
  | 'Yu-Gi-Oh!'
  | 'Disney Lorcana'
  | 'Riftbound'
  | 'Sports Cards';

export const GAMES: Game[] = [
  'Pokémon',
  'Magic: The Gathering',
  'Yu-Gi-Oh!',
  'Disney Lorcana',
  'Riftbound',
  'Sports Cards',
];

export interface Listing {
  id: string;
  sellerId: string;
  sellerUsername: string | null;
  // Real aggregates over the seller's reviews (0/0 when they have none
  // yet) — never a placeholder rating. Design doc v2 §3's trust tier.
  // Mirrors apps/web/lib/types.ts's Listing exactly.
  sellerRatingAvg: number;
  sellerReviewCount: number;
  sellerTier: SellerTier;
  title: string;
  game: Game;
  set: string;
  cardNumber?: string;
  rarity?: string;
  condition: string;
  isGraded: boolean;
  gradingCompany?: string;
  grade?: string;
  certNumber?: string;
  format: 'auction' | 'fixed';
  priceCents?: number;
  freeShipping: boolean;
  shippingCostCents: number;
  imageUrls: string[];
  watcherCount: number;
  status: string;
  createdAt: string;

  // Auction-only fields
  startingBidCents?: number;
  currentPriceCents?: number;
  highBidderId?: string;
  bidCount?: number;
  endsAt?: string;

  // Only ever set on an auction-format listing — the optional "skip the
  // bidding entirely" price. Undefined means this is a plain auction.
  buyItNowPriceCents?: number;

  // Set once cmd/worker's auction-close pass, or a Buy It Now purchase, has
  // processed this listing: "sold" (won via bidding), "no_bids", or
  // "bought_now" (purchased outright, skipping bidding). Undefined until
  // then, including for the entire lifetime of a still-active auction.
  outcome?: 'sold' | 'no_bids' | 'bought_now';

  // When the auction actually closed — distinct from endsAt (the originally
  // scheduled end time), since a Buy It Now purchase closes an auction
  // before its clock runs out. Undefined until closed.
  closedAt?: string;

  // Only ever set for a *fixed*-format listing bought via Buy It Now — a
  // fixed listing has no auction row to record this on.
  buyerId?: string;
  soldAt?: string;

  // Set only when a real Stripe charge actually captured for this
  // purchase. Undefined for a purchase made through the no-Stripe
  // mock-payment path, or a plain auction win via bidding (no checkout
  // step exists for that yet) — both are genuinely still awaiting
  // payment, not a stale value.
  paidAt?: string;

  // Mirrors sellerUsername but for whoever actually bought this listing —
  // undefined until there's a real buyer. Backs Sold History, the
  // seller-side mirror of Buy History's own sellerUsername.
  buyerUsername?: string;
}

// The price actually paid for a purchased listing — its fixed price for a
// Buy It Now purchase, or the auction's final current price for a win
// (whether by bidding or by Buy It Now on an auction-format listing).
// Mirrors apps/web/lib/types.ts's purchasePriceCents exactly.
export function purchasePriceCents(listing: Listing): number {
  return listing.format === 'fixed' ? (listing.priceCents ?? 0) : (listing.currentPriceCents ?? 0);
}

// When a purchased listing was actually bought — soldAt for a fixed-format
// purchase, closedAt (not endsAt) for an auction win. Mirrors
// apps/web/lib/types.ts's purchaseDate exactly.
export function purchaseDate(listing: Listing): string | undefined {
  return listing.format === 'fixed' ? listing.soldAt : listing.closedAt;
}

// A listing that's no longer an active, purchasable offer — an auction
// that's ended (whether it sold or not) or a fixed-price listing that
// already sold. Mirrors apps/web/lib/types.ts's hasListingEnded exactly.
// GET /listings and its filters (apps/api/internal/listing's ListActive)
// already exclude these by default; this is for the couple of screens that
// fetch a listing directly by id instead (Recently Viewed, Watchlist) and
// so bypass that server-side filter entirely — Recently Viewed/Watchlist/
// Live Auctions/an unfiltered browse must never surface an ended or sold
// listing, only the Sold filter should.
export function hasListingEnded(listing: Listing): boolean {
  if (listing.format === 'fixed') return Boolean(listing.buyerId);
  return Boolean(listing.outcome) || (listing.endsAt ? new Date(listing.endsAt).getTime() <= Date.now() : false);
}

// The exact moment a listing actually sold, or undefined if it never did —
// including an auction that simply timed out with no bids: closedAt is set
// for that case too (close.go stamps it regardless of outcome), but it must
// never be shown as a "sold" date since there was no sale. Mirrors
// apps/web/lib/types.ts's listingSoldAt exactly.
export function listingSoldAt(listing: Listing): string | undefined {
  if (listing.format === 'fixed') return listing.buyerId ? listing.soldAt : undefined;
  return listing.outcome === 'sold' || listing.outcome === 'bought_now' ? listing.closedAt : undefined;
}

export interface MyBid {
  listing: Listing;
  myMaxBidCents: number;
  status: 'winning' | 'outbid';
}

// Mirrors apps/api/internal/order.State / apps/web/lib/api.ts's OrderState
// exactly (design doc v2 §5.1).
export type OrderState =
  | 'created'
  | 'payment_pending'
  | 'paid'
  | 'awaiting_ship'
  | 'shipped'
  | 'delivered'
  | 'claim_window'
  | 'released'
  | 'claim_open'
  | 'refunded'
  | 'cancelled';

// Mirrors apps/api/internal/order.Order / apps/web/lib/api.ts's Order
// exactly. Only exists for a purchase made through the real Connect
// checkout path — a mock purchase has no order at all.
export interface Order {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  state: OrderState;
  rail?: 'card' | 'ach';
  tierAtSale: string;
  subtotalCents: number;
  shippingCents: number;
  sellerFeeCents: number;
  sellerNetCents: number;
  taxCents: number;
  chargedCents: number;
  trackingNumber?: string;
  carrier?: string;
  shippedAt?: string;
  deliveredAt?: string;
  claimDeadline?: string;
  releasedAt?: string;
  createdAt: string;
}

// Mirrors apps/api/internal/order.Summary / apps/web/lib/api.ts's
// OrderSummary exactly — the Transactions tab's one row shape.
export interface OrderSummary extends Order {
  listingTitle: string;
  listingImageUrl?: string;
  counterpartyId: string;
  counterpartyUsername?: string;
  viewerIsSeller: boolean;
}

// Mirrors apps/api/internal/order.EvidenceType / apps/web/lib/api.ts's
// EvidenceType exactly.
export type EvidenceType = 'card_front' | 'card_back' | 'package_sealed' | 'arrival_photo' | 'claim_photo';

// The happy-path order lifecycle (design doc v2 §5) — shared between the
// full order-status timeline and the compact per-row bubbles on the
// Transactions list, same source-of-truth split as
// apps/web/lib/orderSteps.ts.
export const ORDER_STEPS: { state: OrderState; label: string }[] = [
  { state: 'paid', label: 'Paid' },
  { state: 'awaiting_ship', label: 'Awaiting shipment' },
  { state: 'shipped', label: 'Shipped' },
  { state: 'delivered', label: 'Delivered' },
  { state: 'claim_window', label: 'Claim window' },
  { state: 'released', label: 'Released to seller' },
];

// A terminal state (refunded/cancelled) or claim_open falls outside the
// happy-path steps above — rendered as its own line rather than forced
// onto the linear timeline.
export const ORDER_OFF_PATH_LABELS: Partial<Record<OrderState, string>> = {
  cancelled: 'Cancelled — refunded in full',
  refunded: 'Refunded',
  claim_open: 'Claim open — under review',
};

// Mirrors apps/api/internal/dispute / apps/web/lib/api.ts's claim types
// exactly (design doc v2 §9).
export type ClaimState =
  | 'opened'
  | 'negotiating'
  | 'escalated'
  | 'auto_adjudicated'
  | 'human_review'
  | 'decided'
  | 'appealed'
  | 'closed';

export type ClaimReasonCode =
  | 'not_as_described'
  | 'not_received_no_tracking'
  | 'not_received_tracking_delivered'
  | 'payment_fraud'
  | 'buyers_remorse'
  | 'transit_damage';

export type ClaimResolution = 'refund_buyer' | 'deny' | 'partial_refund' | 'platform_absorb';
export type ClaimLiableParty = 'seller' | 'buyer' | 'platform';

export interface Claim {
  id: string;
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

export type ClaimEventKind = 'message' | 'evidence' | 'partial_refund_offer' | 'escalation' | 'decision' | 'appeal';

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

// Mirrors apps/api/internal/seller.Tier exactly (same as apps/web/lib/api.ts's SellerTier).
export type SellerTier = 'new' | 'bronze' | 'silver' | 'gold' | 'hous_trust';

export interface Me {
  id: string;
  email: string;
  username: string | null;
  bio: string | null;
  createdAt: string;
  tier: SellerTier;
}

// The public-facing (no email) profile shape returned by GET /users/{username}
// — mirrors apps/web/lib/api.ts's PublicUser exactly (same Go endpoint,
// same ToPublic() shape).
export interface PublicUser {
  id: string;
  username: string | null;
  bio: string | null;
  createdAt: string;
  tier: SellerTier;
}

// Mirrors apps/web/lib/types.ts's formatSellerTier exactly — same copy, so
// "New Seller" isn't hidden or softened just because it's the entry tier.
export function formatSellerTier(tier: SellerTier): string {
  switch (tier) {
    case 'hous_trust':
      return 'Hous Trusted Seller';
    case 'gold':
      return 'Gold Seller';
    case 'silver':
      return 'Silver Seller';
    case 'bronze':
      return 'Bronze Seller';
    default:
      return 'New Seller';
  }
}

// Mirrors apps/web/lib/types.ts's sellerTierRate exactly — same rates as
// apps/api/internal/seller.tierPct (design doc v2 §3.1).
export function sellerTierRate(tier: SellerTier): string {
  switch (tier) {
    case 'hous_trust':
      return '5.50%';
    case 'gold':
      return '6.00%';
    case 'silver':
      return '6.25%';
    case 'bronze':
      return '6.50%';
    default:
      return '7.00%';
  }
}

export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

export function formatTimeLeft(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'Ended';

  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

// Mirrors apps/web/lib/format.ts's formatRelativeTime exactly — same "12m
// ago" / "3d ago" shorthand, used by the messages inbox/thread view.
export function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// The exact moment something happened — "Aug 15, 2026, 6:39 PM" — distinct
// from formatRelativeTime's rough shorthand. Mirrors apps/web/lib/format.ts's
// formatDateTime exactly. Used where the precise timestamp itself is the
// point (a Sold-filtered listing's sale time), not just a sense of how long
// ago it was.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
