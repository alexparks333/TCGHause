import Link from "next/link";
import type { MyBid } from "@/lib/types";
import { formatPrice, formatTimeLeft } from "@/lib/types";

export default function BidsTable({ items }: { items: MyBid[] }) {
  if (items.length === 0) {
    return <p className="mt-6 text-sm text-gray-500">You don't have any active bids or offers.</p>;
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-brand-border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-border bg-brand-surface text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3 font-medium">Item</th>
            <th className="px-4 py-3 font-medium">Your max bid</th>
            <th className="px-4 py-3 font-medium">Current bid</th>
            <th className="px-4 py-3 font-medium">Time left</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ listing, myMaxBidCents, status }) => (
            <tr key={listing.id} className="border-b border-brand-border last:border-0">
              <td className="px-4 py-3">
                <Link
                  href={`/listing/${listing.id}`}
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
                {listing.endsAt ? formatTimeLeft(listing.endsAt) : ""}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${
                    status === "winning" ? "bg-brand-success" : "bg-brand-urgent"
                  }`}
                >
                  {status === "winning" ? "Winning" : "Outbid"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
