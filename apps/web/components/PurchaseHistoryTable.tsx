"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Listing } from "@/lib/types";
import { formatPrice, purchasePriceCents, purchaseDate } from "@/lib/types";

// Shared by Buy History and Sold History — same table shape either way,
// just which side of the transaction the counterparty column names.
type Role = "buying" | "selling";

const EMPTY_MESSAGE: Record<Role, string> = {
  buying: "You haven't bought anything yet.",
  selling: "You haven't sold anything yet.",
};

// Whole-row click needs a router, same reasoning as BidsTable — a Server
// Component can't hand this a function prop, and wrapping a <tr> in an
// anchor isn't valid HTML.
export default function PurchaseHistoryTable({
  items,
  role = "buying",
}: {
  items: Listing[];
  role?: Role;
}) {
  const router = useRouter();

  if (items.length === 0) {
    return <p className="mt-6 text-sm text-gray-500">{EMPTY_MESSAGE[role]}</p>;
  }

  const counterpartyLabel = role === "buying" ? "Seller" : "Buyer";

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-brand-border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-border bg-brand-surface text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3 font-medium">Item</th>
            <th className="px-4 py-3 font-medium">Price</th>
            <th className="px-4 py-3 font-medium">{counterpartyLabel}</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Payment</th>
          </tr>
        </thead>
        <tbody>
          {items.map((listing) => {
            const href = `/listing/${listing.id}`;
            const date = purchaseDate(listing);
            const counterpartyUsername =
              role === "buying" ? listing.sellerUsername : listing.buyerUsername;
            const counterpartyHref = counterpartyUsername ? `/seller/${counterpartyUsername}` : null;
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
                  <p className="text-xs text-gray-500">
                    {listing.game} · {listing.set}
                  </p>
                </td>
                <td className="px-4 py-3 font-semibold text-gray-900">
                  {formatPrice(purchasePriceCents(listing))}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {counterpartyHref ? (
                    <Link
                      href={counterpartyHref}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-brand-navy hover:underline"
                    >
                      {counterpartyUsername}
                    </Link>
                  ) : (
                    counterpartyLabel
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {date
                    ? new Date(date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : ""}
                </td>
                <td className="px-4 py-3">
                  {listing.paidAt ? (
                    <span className="inline-block rounded-full bg-brand-success/10 px-2 py-0.5 text-xs font-semibold text-brand-success">
                      Paid
                    </span>
                  ) : (
                    <span
                      className="inline-block rounded-full bg-brand-urgent/10 px-2 py-0.5 text-xs font-semibold text-brand-urgent"
                      title="No payment has been collected for this purchase yet"
                    >
                      Awaiting payment
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
