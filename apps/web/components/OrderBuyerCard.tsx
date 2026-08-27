import Link from "next/link";
import { User } from "lucide-react";
import Avatar from "./Avatar";
import BuyerReviewForm from "./BuyerReviewForm";
import StarRating from "./StarRating";
import type { BuyerReview, BuyerReviewTag, BuyerStats, OrderState } from "@/lib/api";

// Mirrors buyerreview.orderComplete on the backend exactly — a seller
// shouldn't be able to rate a buyer's behavior before the sale has actually
// played out (a claim or shipping problem can still change the story), so
// the form itself stays hidden until the order reaches one of these two
// states. Upsert enforces this independently server-side; this is just
// what decides whether to show the form at all.
function orderComplete(state: OrderState): boolean {
  return state === "released" || state === "refunded";
}

const TAG_STYLES: Record<BuyerReviewTag, string> = {
  trustworthy: "bg-green-50 text-green-700",
  suspicious: "bg-amber-50 text-amber-700",
  aggressive: "bg-red-50 text-brand-urgent",
};

const TAG_LABELS: Record<BuyerReviewTag, string> = {
  trustworthy: "Trustworthy",
  suspicious: "Suspicious",
  aggressive: "Aggressive",
};

function formatPct(pct: number): string {
  return `${Number(pct.toFixed(1))}%`;
}

// The seller-side mirror of OrderReceipt — same box treatment (rounded-xl
// border/white/p-5), same "float in the margin, don't disturb the
// centered card's own centering math" placement on the order page, just
// on the left instead of the right. Only ever rendered for the seller
// (the buyer already knows who they are), same gating as OrderReceipt.
// Also the entry point for internal/buyerreview: the keyword tag next to
// the buyer's name is the plurality of every "trustworthy/suspicious/
// aggressive" tag past sellers have left them, and the three stat lines
// below are computed live from their order/claim history, never a stored
// counter that could drift (CLAUDE.md §5.4's spirit, applied to buyers).
export default function OrderBuyerCard({
  username,
  listingId,
  stats,
  existingReview,
  orderState,
}: {
  username: string;
  listingId: string;
  stats: BuyerStats;
  existingReview: BuyerReview | null;
  orderState: OrderState;
}) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <User size={16} /> Buyer
      </h2>

      <Link href={`/seller/${username}`} className="group mt-4 flex items-center gap-3">
        <Avatar label={username} size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900 group-hover:text-brand-navy group-hover:underline">
            {username}
          </p>
          {stats.tag && (
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TAG_STYLES[stats.tag]}`}
            >
              {TAG_LABELS[stats.tag]}
            </span>
          )}
        </div>
      </Link>

      {stats.reviewCount > 0 && (
        <div className="mt-3 flex items-center gap-1.5">
          <StarRating rating={stats.averageRating} size={13} />
          <span className="text-xs text-gray-500">
            {stats.averageRating.toFixed(1)} ({stats.reviewCount})
          </span>
        </div>
      )}

      <dl className="mt-4 flex flex-col gap-2 border-t border-brand-border pt-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-gray-600">Buys made</dt>
          <dd className="font-medium text-gray-900">{stats.buysMade}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-gray-600">Buys refunded</dt>
          <dd className="font-medium text-gray-900">
            {formatPct(stats.refundedPct)}{" "}
            <span className="font-normal text-gray-400">
              ({stats.refundedCount}/{stats.buysMade})
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-gray-600">Claims made</dt>
          <dd className="font-medium text-gray-900">
            {formatPct(stats.claimsPct)}{" "}
            <span className="font-normal text-gray-400">
              ({stats.claimsCount}/{stats.buysMade})
            </span>
          </dd>
        </div>
      </dl>

      {orderComplete(orderState) ? (
        <BuyerReviewForm listingId={listingId} existingReview={existingReview} />
      ) : (
        <p className="mt-4 border-t border-brand-border pt-3 text-xs text-gray-400">
          You can review this buyer once the order is complete.
        </p>
      )}
    </div>
  );
}
