// Canonical Listing shape — mirrors apps/api/internal/listing.Listing's
// JSON exactly. This is real API data; there is no mock listing type
// anymore (see git history for the old lib/mock-listings.ts if needed).

export type Game =
  | "Pokémon"
  | "Magic: The Gathering"
  | "Yu-Gi-Oh!"
  | "Disney Lorcana"
  | "Riftbound"
  | "Sports Cards";

// Mirrors apps/api/internal/catalog.AllGames exactly — the one place this
// list is written out on the frontend (CategoryNav, the Sell wizard's game
// dropdown) so there's a single spot to update if a game is ever added.
export const GAMES: Game[] = [
  "Pokémon",
  "Magic: The Gathering",
  "Yu-Gi-Oh!",
  "Disney Lorcana",
  "Riftbound",
  "Sports Cards",
];

// Mirrors apps/api/internal/cardcatalog.Card's JSON exactly — a card from
// TCG Haven's Firestore catalog, read-only. Used by the Sell wizard's
// autofill (Step1Details, always called with a game already chosen) and
// the Favorite Card widget picker (ProfileEditor, searches every game at
// once via searchCatalogCardsAllGames — see `game` below). Only Pokémon/
// Disney Lorcana/Riftbound have any results; GET /catalog/search returns
// [] for the other games.
export interface CatalogCard {
  id: string;
  name: string;
  set: string;
  setName: string;
  number: string;
  rarity: string;
  // The AuctionHous game this result came from ("Pokémon", not TCG
  // Haven's "pokemon" slug) — always populated by the API now, but only
  // load-bearing for the all-games picker, which has no other way to know
  // which game a given result belongs to.
  game: string;
  imageUrl: string;
  tags: string[] | null;
  hidden: boolean;
}

// Mirrors apps/api/internal/shipping.Preset's five values exactly. Each is
// locked to one fulfillment mechanism (free_envelope/tracked_envelope ->
// Pitney Bowes; everything else -> Shippo) — see that package's doc
// comment for the full policy.
export type ShippingPreset =
  | "free_envelope"
  | "free_bubble_mailer"
  | "free_box"
  | "tracked_envelope"
  | "shippo_ground_advantage";

export interface Listing {
  id: string;
  sellerId: string;
  sellerUsername: string | null;
  // Real aggregates over the seller's reviews (0/0 when they have none yet)
  // — never a placeholder rating.
  sellerRatingAvg: number;
  sellerReviewCount: number;
  // Design doc v2 §3's trust tier — mirrors apps/api/internal/seller.Tier.
  // Platinum sits between Gold and Haus Trust; Haus Trust is the top tier,
  // application-only, with an individually negotiated rate (see
  // sellerTierRate below).
  sellerTier: "new" | "bronze" | "silver" | "gold" | "platinum" | "haus_trust";
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
  format: "auction" | "fixed";
  priceCents?: number;
  // The seller's chosen shipping method at listing time (Sell wizard's
  // Step3Price) — a floor only; a low-starting-bid auction may resolve
  // stricter at sale time, see Order.shippingPreset's doc comment in
  // lib/api.ts. No separate freeShipping/shippingCostCents anymore —
  // free-ness and packaging are both encoded in the preset value itself.
  shippingPreset: ShippingPreset;
  // Only ever set for the shippo_ground_advantage preset — a one-time
  // estimate computed when the listing was created (a real buyer address
  // isn't known yet, so this is never the guaranteed final cost).
  estimatedShippingCents?: number;
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
  outcome?: "sold" | "no_bids" | "bought_now";

  // When the auction actually closed — distinct from endsAt (the originally
  // scheduled end time), since a Buy It Now purchase closes an auction
  // before its clock runs out. Undefined until closed.
  closedAt?: string;

  // Only ever set for a *fixed*-format listing bought via Buy It Now — a
  // fixed listing has no auction row to record this on.
  buyerId?: string;
  soldAt?: string;

  // Set only when a real Stripe charge actually captured for this
  // purchase (internal/auction.HandleBuyNow). Undefined for a purchase
  // made through the no-Stripe mock-payment path, or a plain auction win
  // via bidding (no checkout step exists for that yet) — both are
  // genuinely still awaiting payment, not a stale value.
  paidAt?: string;

  // Mirrors sellerUsername but for whoever actually bought this listing —
  // undefined until there's a real buyer (an active listing, or an
  // auction that closed with no bids at all never has one). Backs Sold
  // History, the seller-side mirror of Buy History's own sellerUsername.
  buyerUsername?: string;
}

// A listing that's no longer an active, purchasable offer — an auction
// that's ended (whether it sold or not) or a fixed-price listing that
// already sold. GET /listings and its filters (apps/api/internal/listing's
// ListActive) already exclude these by default; this is for the couple of
// screens that fetch a listing directly by id instead (Watchlist here,
// Recently Viewed on mobile) and so bypass that server-side filter
// entirely — Recently Viewed/Watchlist/Live Auctions/an unfiltered browse
// must never surface an ended or sold listing, only the Sold filter should.
export function hasListingEnded(listing: Listing): boolean {
  if (listing.format === "fixed") return Boolean(listing.buyerId);
  return Boolean(listing.outcome) || (listing.endsAt ? new Date(listing.endsAt).getTime() <= Date.now() : false);
}

// The exact moment a listing actually sold, or undefined if it never did —
// including an auction that simply timed out with no bids: closedAt is set
// for that case too (close.go stamps it regardless of outcome), but it must
// never be shown as a "sold" date since there was no sale. Distinct from
// MyBid/purchase-history's own date logic (that data only ever contains
// listings the caller actually won/bought in the first place, so it doesn't
// need this same guard) — this is for rendering a sale date on a listing
// card/row in a general Sold-filtered result set, which can include any
// auction's outcome.
export function listingSoldAt(listing: Listing): string | undefined {
  if (listing.format === "fixed") return listing.buyerId ? listing.soldAt : undefined;
  return listing.outcome === "sold" || listing.outcome === "bought_now" ? listing.closedAt : undefined;
}

export interface MyBid {
  listing: Listing;
  myMaxBidCents: number;
  status: "winning" | "outbid";
}

// A win via regular bidding (not Buy It Now) that hasn't been paid for
// yet — internal/auction.PayForWonAuction is what actually collects
// payment for this, at the final winning bid (currentPriceCents). Kept
// deliberately separate from hasBidEnded below: a won-but-unpaid auction
// stays in Bids/Offers' Active section (there's still something to do —
// pay for it), not Ended, unlike every other closed auction.
export function isAwaitingPayment(bid: MyBid): boolean {
  return bid.status === "winning" && bid.listing.outcome === "sold" && !bid.listing.paidAt;
}

// A winning bidder gets ~1 day from when the auction actually closed to
// pay before the win is at risk — Buy It Now already collects payment
// atomically at purchase time, so this only applies to a regular auction
// win. Purely a display deadline for now (no backend field/enforcement
// exists yet to cancel an unpaid win after this passes) — surfaced as a
// live countdown next to "Awaiting Payment" so a winner actually sees the
// clock running, not just a static reminder.
export const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Undefined when there's no closedAt to count from (shouldn't happen once
// isAwaitingPayment(bid) is true, since the backend sets outcome and
// closedAt together — see internal/auction's close pass).
export function paymentDueAt(listing: Listing): string | undefined {
  if (!listing.closedAt) return undefined;
  return new Date(new Date(listing.closedAt).getTime() + PAYMENT_WINDOW_MS).toISOString();
}

// Bids/Offers' "Active" vs "Ended" split. An auction genuinely closing —
// whether its clock ran out OR it was bought outright via Buy It Now
// before that (outcome gets set either way, well before a Buy-It-Now
// purchase's endsAt) — is what "ended" means, not just endsAt in the
// past: relying on endsAt alone left a listing someone else bought via
// Buy It Now looking like it was "still running" on every other bidder's
// account, since its originally-scheduled end time hadn't arrived yet
// even though the auction had very much already closed.
export function hasBidEnded(bid: MyBid): boolean {
  if (isAwaitingPayment(bid)) return false;
  return (
    Boolean(bid.listing.outcome) ||
    (Boolean(bid.listing.endsAt) && new Date(bid.listing.endsAt!).getTime() <= Date.now())
  );
}

const CARD_BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
};

// Shared by SavedCardsManager and MockCheckout's saved-card quick-pay
// button, so a card's brand always reads the same way everywhere it's
// shown.
export function formatCardBrand(brand: string): string {
  return CARD_BRAND_LABELS[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

// The price actually paid for a purchased listing — its fixed price for a
// Buy It Now purchase, or the auction's final current price for a win
// (whether by bidding or by Buy It Now on an auction-format listing).
export function purchasePriceCents(listing: Listing): number {
  return listing.format === "fixed" ? listing.priceCents ?? 0 : listing.currentPriceCents ?? 0;
}

// When a purchased listing was actually bought — soldAt for a fixed-format
// purchase, closedAt (not endsAt, which is only the originally scheduled
// time) for an auction win.
export function purchaseDate(listing: Listing): string | undefined {
  return listing.format === "fixed" ? listing.soldAt : listing.closedAt;
}

export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Mirrors apps/api/internal/shipping.TrackedEnvelopeCents exactly — the
// flat buyer-facing price for the tracked_envelope preset.
export const TRACKED_ENVELOPE_CENTS = 151;

// The one "how does this ship, and what does it cost" line, shared by
// every place a listing renders shipping info (ListingCard, ListingRow,
// the listing detail page, checkout) — previously each of those
// duplicated a freeShipping/shippingCostCents ternary; now it's all
// derived from the single shippingPreset value.
export function shippingDisplayText(listing: Listing): string {
  switch (listing.shippingPreset) {
    case "free_envelope":
    case "free_bubble_mailer":
    case "free_box":
      return "Free shipping";
    case "tracked_envelope":
      return `+${formatPrice(TRACKED_ENVELOPE_CENTS)} shipping`;
    case "shippo_ground_advantage":
      return listing.estimatedShippingCents != null
        ? `~${formatPrice(listing.estimatedShippingCents)} shipping (est.)`
        : "Shipping calculated at checkout";
    default:
      return "Shipping calculated at checkout";
  }
}

// The listing detail page's fuller "what you'll actually get" line —
// cost and packaging shown as two distinct parts (e.g. "Free Shipping"
// + "Bubble Mailer", "$1.51" + "Tracked Envelope") rather than
// shippingDisplayText's single compact sentence used on cards/rows/
// checkout, since a buyer deciding whether to bid/buy benefits from
// knowing the actual mechanism, not just the price.
const SHIPPING_METHOD_LABELS: Record<ShippingPreset, string> = {
  free_envelope: "Envelope",
  free_bubble_mailer: "Bubble Mailer",
  free_box: "Box",
  tracked_envelope: "Tracked Envelope",
  shippo_ground_advantage: "Ground Advantage (Tracked Package)",
};

export function shippingMethodLabel(listing: Listing): string {
  return SHIPPING_METHOD_LABELS[listing.shippingPreset];
}

export function shippingCostLabel(listing: Listing): string {
  switch (listing.shippingPreset) {
    case "free_envelope":
    case "free_bubble_mailer":
    case "free_box":
      return "Free Shipping";
    case "tracked_envelope":
      return `+${formatPrice(TRACKED_ENVELOPE_CENTS)} shipping`;
    case "shippo_ground_advantage":
      return listing.estimatedShippingCents != null
        ? `~${formatPrice(listing.estimatedShippingCents)} shipping`
        : "Shipping cost at checkout";
    default:
      return "Shipping cost at checkout";
  }
}

// Display label for a seller trust tier (design doc v2 §3.1) — "New"
// deliberately isn't hidden or softened just because it's the entry tier;
// the whole ladder is meant to be visible, not just the tiers worth
// bragging about (see app/tiers/page.tsx).
export function formatSellerTier(tier: Listing["sellerTier"]): string {
  switch (tier) {
    case "haus_trust":
      return "Haus Trusted Seller";
    case "platinum":
      return "Platinum Seller";
    case "gold":
      return "Gold Seller";
    case "silver":
      return "Silver Seller";
    case "bronze":
      return "Bronze Seller";
    default:
      return "New Seller";
  }
}

// The engraved-card tier badge art (public/tiers/*.png) — null for "new"
// and "platinum" (no platinum art commissioned yet), callers fall back to
// a plain icon (e.g. lucide's ShieldCheck) in that case rather than render
// nothing.
export function sellerTierIconSrc(tier: Listing["sellerTier"]): string | null {
  switch (tier) {
    case "haus_trust":
      return "/tiers/haus.png";
    case "gold":
      return "/tiers/gold.png";
    case "silver":
      return "/tiers/silver.png";
    case "bronze":
      return "/tiers/bronze.png";
    default:
      return null;
  }
}

// Each tier's identity color, matching its card icon's metal tone (bronze
// copper, silver, gold, platinum's pale steel, Haus Trust's ice blue) —
// tuned for use on a dark navy background (TopBar/Hero), not for light
// surfaces like SellerCard's white background, where the plain gray badge
// text stays as-is.
export function sellerTierAccentColorClass(tier: Listing["sellerTier"]): string {
  switch (tier) {
    case "haus_trust":
      return "text-[#8ec5ff]";
    case "platinum":
      return "text-[#e5e4e2]";
    case "gold":
      return "text-brand-gold-light";
    case "silver":
      return "text-[#c0c0c0]";
    case "bronze":
      return "text-[#cd7f32]";
    default:
      return "text-white";
  }
}

// The stickers offered on the profile canvas's Background layer
// (StickerBoard.tsx) — exactly the tier icon art that already exists
// (sellerTierIconSrc above); "new" and "platinum" have no commissioned art
// yet, so they're not offered here either. Mirrors
// apps/api/internal/user.validStickerKinds exactly — keep both lists in
// sync if a new sticker is ever added. This is also the one indirection
// point an animated sticker later hooks into: a GIF/WebP/APNG `src` here
// just animates in the existing <img>, no placement-data or component
// change needed (see the profile-canvas plan's forward-compat notes).
export const PROFILE_STICKER_OPTIONS: { kind: string; label: string; src: string }[] = [
  { kind: "bronze", label: "Bronze Tier", src: "/tiers/bronze.png" },
  { kind: "silver", label: "Silver Tier", src: "/tiers/silver.png" },
  { kind: "gold", label: "Gold Tier", src: "/tiers/gold.png" },
  { kind: "haus_trust", label: "Haus Trust", src: "/tiers/haus.png" },
];

export function profileStickerSrc(kind: string): string | undefined {
  return PROFILE_STICKER_OPTIONS.find((s) => s.kind === kind)?.src;
}

// The content widgets offered on the profile canvas's Widgets tab
// (ProfileEditorPalette.tsx) — mirrors
// apps/api/internal/user.validWidgetTypes exactly. Data-driven on purpose:
// a new widget type later (a Showcase, achievements/badges, ...) is an
// additional entry plus one renderer in ProfileEditor.tsx, not a rewrite
// of the palette or the drag-to-reorder list.
export const WIDGET_CATALOG: { type: string; label: string; description: string }[] = [
  {
    type: "listings",
    label: "Listings",
    description: "A scrollable row of your active listings.",
  },
  {
    type: "favorite_card",
    label: "Favorite Card",
    description: "Showcase any card from our catalog as its own art piece.",
  },
  {
    type: "empty_space",
    label: "Empty Space",
    description: "A blank 1x1 spacer to leave breathing room in the layout.",
  },
];

// Mirrors apps/api/internal/user.maxWidgets exactly.
export const MAX_WIDGETS = 6;

// Commission rate for a seller trust tier — mirrors
// apps/api/internal/seller.tierPct exactly (design doc v2 §3.1). Haus
// Trust deliberately has no fixed rate to show here — it's negotiated per
// seller at application approval (apps/api/internal/seller/haustrust.go),
// so "Custom" is the honest answer, not a specific number this function
// could get wrong the moment two Haus Trust sellers have different rates.
export function sellerTierRate(tier: Listing["sellerTier"]): string {
  switch (tier) {
    case "haus_trust":
      return "Custom";
    case "platinum":
      return "5.50%";
    case "gold":
      return "6.00%";
    case "silver":
      return "6.25%";
    case "bronze":
      return "6.50%";
    default:
      return "7.00%";
  }
}

// Under an hour left, show seconds too — "45m 12s left" rather than just
// "45m left" — so the last stretch of an auction reads as an accurate
// live countdown instead of a rounded-off estimate.
export function formatMsLeft(ms: number): string {
  if (ms <= 0) return "Ended";

  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

export function formatTimeLeft(endsAt: string): string {
  return formatMsLeft(new Date(endsAt).getTime() - Date.now());
}
