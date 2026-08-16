"use client";

import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/types";

// Doesn't buy anything itself — just sends the buyer to the mock checkout
// page (app/checkout/[id]), where the real, atomic purchase actually
// happens once they click "Pay". Clicking THIS button must never touch the
// listing at all: the whole point of the checkout step is that browsing to
// it (or even sitting on it) doesn't reserve or take down the listing for
// anyone else — only a completed "payment" does, via the same race-safe
// backend call this button used to make directly. Shared by the fixed-
// format listing box, ListingCard, and AuctionPriceBox's optional Buy It
// Now path (an auction-format listing with buyItNowPriceCents set).
export default function BuyNowButton({
  listingId,
  priceCents,
  label,
}: {
  listingId: string;
  priceCents: number;
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(`/checkout/${listingId}`)}
      className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light"
    >
      {label ?? `Buy It Now for ${formatPrice(priceCents)}`}
    </button>
  );
}
