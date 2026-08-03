import Link from "next/link";
import Avatar from "./Avatar";

// Deliberately minimal: no seller-tier badge here yet (CLAUDE.md §6.4,
// still v1-planned, not built) — real ratings now live on the seller's
// profile page (app/seller/[username]/page.tsx), which this card links to.
// username can be null for a seller who hasn't claimed one yet (shouldn't
// happen for a live listing given the listing.Create gate, but stay
// null-safe rather than assume) — in that case there's no profile to link
// to, so it renders as plain unlinked text.
export default function SellerCard({ username }: { username: string | null }) {
  const label = username ?? "Seller";
  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <div className="flex items-center gap-3">
        <Avatar label={label} size={40} />
        <div className="min-w-0">
          {username ? (
            <Link
              href={`/seller/${username}`}
              className="truncate text-sm font-semibold text-gray-900 hover:text-brand-navy hover:underline"
            >
              {label}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold text-gray-900">{label}</p>
          )}
          <p className="text-xs text-gray-500">Seller</p>
        </div>
      </div>
    </div>
  );
}
