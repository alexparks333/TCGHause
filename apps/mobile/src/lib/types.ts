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

export interface MyBid {
  listing: Listing;
  myMaxBidCents: number;
  status: 'winning' | 'outbid';
}

// Mirrors apps/api/internal/seller.Tier exactly (same as apps/web/lib/api.ts's SellerTier).
export type SellerTier = 'new' | 'bronze' | 'silver' | 'gold' | 'haus_trust';

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
    case 'haus_trust':
      return 'Haus Trusted Seller';
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
    case 'haus_trust':
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
