import Link from "next/link";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import Avatar from "./Avatar";
import MessageSellerButton from "./messages/MessageSellerButton";
import { formatSellerTier, sellerTierIconSrc, type Listing } from "@/lib/types";

// Real ratings live on the seller's profile page
// (app/seller/[username]/page.tsx), which this card links to. tier is
// design doc v2 §3's trust tier — always real (§2.7's "publish the full
// tier ladder openly" applies here too: even a New seller shows their
// actual tier, not a hidden/blank state). username can be null for a
// seller who hasn't claimed one yet (shouldn't happen for a live listing
// given the listing.Create gate, but stay null-safe rather than assume) —
// in that case there's no profile to link to, so it renders as plain
// unlinked text.
//
// sellerId/listingId/canMessage are all optional — the checkout page also
// renders this card (username + tier only) where a "Message Seller" button
// doesn't belong; only the listing detail page passes the rest, and only
// once it knows the viewer is logged in and isn't the seller themselves.
export default function SellerCard({
  username,
  tier,
  sellerId,
  listingId,
  canMessage = false,
}: {
  username: string | null;
  tier: Listing["sellerTier"];
  sellerId?: string;
  listingId?: string;
  canMessage?: boolean;
}) {
  const label = username ?? "Seller";
  const tierIcon = sellerTierIconSrc(tier);
  const inner = (
    <>
      <Avatar label={label} size={40} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-900 group-hover:text-brand-navy group-hover:underline">
          {label}
        </p>
        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-brand-surface px-2 py-0.5 text-[11px] font-medium text-gray-600">
          {tierIcon ? (
            <Image src={tierIcon} alt="" width={14} height={14} unoptimized />
          ) : (
            <ShieldCheck size={11} />
          )}
          {formatSellerTier(tier)}
        </span>
      </div>
    </>
  );
  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      {username ? (
        // The whole avatar+name cluster is one click target, not just the
        // text — a profile picture next to a name reads as clickable, and
        // it was silently dead space before.
        <Link href={`/seller/${username}`} className="group flex items-center gap-3">
          {inner}
        </Link>
      ) : (
        <div className="flex items-center gap-3">{inner}</div>
      )}
      {canMessage && sellerId && (
        <MessageSellerButton recipientId={sellerId} recipientLabel={label} listingId={listingId} />
      )}
    </div>
  );
}
