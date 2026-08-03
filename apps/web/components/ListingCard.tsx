"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Zap, Check } from "lucide-react";
import ListingImage from "./ListingImage";
import { apiFetch } from "@/lib/api";
import { type Listing, type MyBid, formatPrice, formatTimeLeft } from "@/lib/types";

export default function ListingCard({
  listing,
  initialWatching = false,
  isLoggedIn = false,
  myBid,
}: {
  listing: Listing;
  initialWatching?: boolean;
  isLoggedIn?: boolean;
  myBid?: MyBid;
}) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [busy, setBusy] = useState(false);
  const hasEnded =
    listing.format === "auction" &&
    listing.endsAt !== undefined &&
    new Date(listing.endsAt).getTime() <= Date.now();
  const isUrgent =
    listing.format === "auction" &&
    listing.endsAt !== undefined &&
    new Date(listing.endsAt).getTime() - Date.now() <= 30 * 60 * 1000;

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-brand-border bg-white transition-shadow hover:shadow-md">
      <Link
        href={`/listing/${listing.id}`}
        className="relative block aspect-[4/5] overflow-hidden"
      >
        <div className="h-full w-full transition-transform duration-300 group-hover:scale-105">
          <ListingImage src={listing.imageUrls?.[0]} game={listing.game} label={listing.title} />
        </div>

        {listing.format !== "auction" && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-success px-2 py-1 text-[11px] font-semibold text-white">
            <Zap size={12} /> Buy It Now
          </span>
        )}

        <button
          type="button"
          onClick={async (e) => {
            e.preventDefault();
            if (busy) return;
            if (!isLoggedIn) {
              router.push("/login");
              return;
            }
            setBusy(true);
            try {
              const status = await apiFetch(`/listings/${listing.id}/watch`, {
                method: watching ? "DELETE" : "POST",
              });
              setWatching(status.watching);
            } catch {
              // Leave state as-is on failure.
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          aria-label={watching ? "Remove from watchlist" : "Add to watchlist"}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors hover:bg-white disabled:opacity-60"
        >
          <Heart
            size={16}
            className={watching ? "fill-brand-urgent text-brand-urgent" : "text-gray-500"}
          />
        </button>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
            {listing.game}
          </p>
          <Link href={`/listing/${listing.id}`}>
            <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 hover:underline">
              {listing.title}
            </h3>
          </Link>
          <p className="mt-0.5 text-xs text-gray-500">
            {listing.set}
            {listing.isGraded
              ? ` · ${listing.gradingCompany} ${listing.grade}`
              : ` · ${listing.condition}`}
          </p>
        </div>

        <div className="mt-auto">
          {listing.format === "auction" ? (
            <div>
              <p className="text-[11px] text-gray-500">Current bid</p>
              <p className="text-lg font-bold text-gray-900">
                {formatPrice(listing.currentPriceCents ?? 0)}
              </p>
              <p className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{listing.bidCount ?? 0} bids</span>
                <span
                  className={isUrgent ? "font-semibold text-brand-urgent" : "text-gray-500"}
                >
                  {listing.endsAt ? formatTimeLeft(listing.endsAt) : ""}
                </span>
              </p>
              {myBid && myBid.status === "winning" && !hasEnded && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-brand-success">
                  <Check size={12} /> Top bidder · up to {formatPrice(myBid.myMaxBidCents)}
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {listing.freeShipping
                  ? "Free shipping"
                  : `+${formatPrice(listing.shippingCostCents)} shipping`}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-lg font-bold text-gray-900">
                {formatPrice(listing.priceCents ?? 0)}
              </p>
              <p className="text-xs text-gray-500">
                {listing.freeShipping
                  ? "Free shipping"
                  : `+${formatPrice(listing.shippingCostCents)} shipping`}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-brand-border pt-2 text-[11px] text-gray-500">
          {listing.sellerUsername ? (
            <Link
              href={`/seller/${listing.sellerUsername}`}
              className="truncate hover:text-brand-navy hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {listing.sellerUsername}
            </Link>
          ) : (
            <span className="truncate">Seller</span>
          )}
        </div>
      </div>
    </div>
  );
}
