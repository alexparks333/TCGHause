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
  format: "auction" | "fixed";
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

  // Set once cmd/worker's auction-close pass has processed this listing:
  // "sold" if it had a high bidder when it closed, "no_bids" if it never
  // got one. Undefined until then, including for the entire lifetime of a
  // still-active auction.
  outcome?: "sold" | "no_bids";
}

export interface MyBid {
  listing: Listing;
  myMaxBidCents: number;
  status: "winning" | "outbid";
}

export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function formatTimeLeft(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "Ended";

  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}
