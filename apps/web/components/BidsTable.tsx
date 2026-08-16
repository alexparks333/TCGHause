"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MyBid } from "@/lib/types";
import { formatPrice, formatTimeLeft, isAwaitingPayment, paymentDueAt } from "@/lib/types";
import PaymentCountdown from "./PaymentCountdown";

// variant (not a badge callback) because this is a Client Component (the
// whole-row onClick below needs a router) — Server Components can't pass
// functions as props across that boundary, only serializable values like
// this string. Both variants derive "won" from bid.status identically,
// only the label text differs, so a plain lookup is enough.
const BADGE_LABEL: Record<"active" | "ended", Record<MyBid["status"], string>> = {
  active: { winning: "Winning", outbid: "Outbid" },
  ended: { winning: "Won", outbid: "Lost" },
};

// ~12 rows worth (header ~41px + 12 * ~44px body rows) before the table
// scrolls internally instead of the page just growing forever — the
// Ended section on Bids/Offers is the one meant to use this, since it
// only ever grows.
const SCROLLABLE_MAX_HEIGHT = "max-h-[560px]";

export default function BidsTable({
  items,
  variant,
  emptyMessage = "You don't have any active bids or offers.",
  scrollable = false,
}: {
  items: MyBid[];
  variant: "active" | "ended";
  emptyMessage?: string;
  scrollable?: boolean;
}) {
  const router = useRouter();

  if (items.length === 0) {
    return <p className="mt-2 text-sm text-gray-500">{emptyMessage}</p>;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-brand-border bg-white">
      <div className={scrollable ? `${SCROLLABLE_MAX_HEIGHT} overflow-y-auto` : ""}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-border bg-brand-surface text-left text-xs uppercase tracking-wide text-gray-500">
              <th className={`px-4 py-3 font-medium ${scrollable ? "sticky top-0 bg-brand-surface" : ""}`}>
                Item
              </th>
              <th className={`px-4 py-3 font-medium ${scrollable ? "sticky top-0 bg-brand-surface" : ""}`}>
                Your max bid
              </th>
              <th className={`px-4 py-3 font-medium ${scrollable ? "sticky top-0 bg-brand-surface" : ""}`}>
                Current bid
              </th>
              <th className={`px-4 py-3 font-medium ${scrollable ? "sticky top-0 bg-brand-surface" : ""}`}>
                Time left
              </th>
              <th className={`px-4 py-3 font-medium ${scrollable ? "sticky top-0 bg-brand-surface" : ""}`}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((bid) => {
              const { listing, myMaxBidCents } = bid;
              const won = bid.status === "winning";
              // Only meaningful in the Active section — a won-but-unpaid
              // auction stays there instead of Ended (lib/types.ts's
              // hasBidEnded), specifically so there's still something
              // actionable to click.
              const awaitingPayment = variant === "active" && isAwaitingPayment(bid);
              // "Pay Now" here, not "Awaiting Payment" — this table is
              // always the buyer's own Bids/Offers view, so it's always
              // THEM who owes the payment, not someone they're waiting on.
              // "Awaiting payment" is reserved for the seller's side
              // (app/account/selling/page.tsx's ListingGrid badge), where
              // it's genuinely accurate — the seller is waiting on the
              // buyer's Stripe checkout, not the other way around.
              const label = awaitingPayment ? "Pay Now" : BADGE_LABEL[variant][bid.status];
              const href = awaitingPayment ? `/checkout/${listing.id}` : `/listing/${listing.id}`;
              const dueAt = awaitingPayment ? paymentDueAt(listing) : undefined;
              return (
                <tr
                  key={listing.id}
                  onClick={() => router.push(href)}
                  className="cursor-pointer border-b border-brand-border last:border-0 hover:bg-brand-surface"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={href}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {listing.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatPrice(myMaxBidCents)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {formatPrice(listing.currentPriceCents ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {awaitingPayment
                      ? "Payment due"
                      : listing.endsAt
                        ? formatTimeLeft(listing.endsAt)
                        : ""}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white transition-opacity hover:opacity-80 ${
                          awaitingPayment
                            ? "bg-brand-gold"
                            : won
                              ? "bg-brand-success"
                              : "bg-brand-urgent"
                        }`}
                      >
                        {label}
                      </Link>
                      {dueAt && <PaymentCountdown dueAt={dueAt} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
