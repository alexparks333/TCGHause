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
  variant = "default",
  className = "",
}: {
  listingId: string;
  priceCents: number;
  label?: string;
  // "split" is ListingCard's compact layout, once the Make an Offer square
  // is sitting next to this button — "Buy It Now for $49.99" wraps to two
  // ragged lines in the narrower leftover space, and a single "Buy It Now"
  // label alone drops the price. Splits "Buy It"/"Now" onto their own small
  // stacked lines to the left of a larger price, both on one row, no
  // wrapping. Ignores `label` when set.
  variant?: "default" | "split";
  // Lets callers that sit this button next to another control in a flex
  // row (e.g. ListingCard's Buy It Now + Make an Offer pair) add flex-1/
  // w-full without every other call site needing to know about that.
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(`/checkout/${listingId}`)}
      className={`rounded-lg bg-brand-gold text-white transition-colors hover:bg-brand-gold-light ${
        variant === "split" ? "px-3 py-2" : "px-4 py-2.5 text-sm font-semibold"
      } ${className}`}
    >
      {variant === "split" ? (
        <span className="flex w-full items-center justify-between gap-1.5">
          <span className="text-base font-bold">{formatPrice(priceCents)}</span>
          <span className="flex flex-col items-center text-[10px] font-semibold uppercase leading-[1.1] tracking-wide opacity-90">
            <span>Buy It</span>
            <span>Now</span>
          </span>
        </span>
      ) : (
        (label ?? `Buy It Now for ${formatPrice(priceCents)}`)
      )}
    </button>
  );
}
