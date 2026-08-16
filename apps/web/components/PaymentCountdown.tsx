"use client";

import { useMsLeft } from "@/lib/useMsLeft";
import { formatMsLeft } from "@/lib/types";

// Live "time left to pay" for a won-but-unpaid auction — next to the
// "Awaiting Payment" badge on Bids/Offers, and on the listing's own page
// after winning it. Its own component (not inlined at each call site)
// specifically so useMsLeft's hook call is legal from inside BidsTable's
// row .map() — hooks can't be called conditionally or in a loop directly,
// but a separate component instance per row is exactly what the rules of
// hooks allow.
export default function PaymentCountdown({ dueAt }: { dueAt: string }) {
  const msLeft = useMsLeft(dueAt);
  if (msLeft === null) return null;
  const expired = msLeft <= 0;

  return (
    <span
      className={`text-xs font-semibold ${expired ? "text-gray-400" : "text-brand-urgent"}`}
      // Same server/client Date.now() skew as every other live countdown
      // on the site (ListingCard, AuctionPriceBox) — corrects within a
      // second via useMsLeft's own interval, not a real hydration bug.
      suppressHydrationWarning
    >
      {expired ? "Payment window expired" : `${formatMsLeft(msLeft)} to pay`}
    </span>
  );
}
