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
}

export interface MyBid {
  listing: Listing;
  myMaxBidCents: number;
  status: 'winning' | 'outbid';
}

export interface Me {
  id: string;
  email: string;
  username: string | null;
  bio: string | null;
  createdAt: string;
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
