"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Zap, Check, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import ListingImage from "./ListingImage";
import BuyNowButton from "./BuyNowButton";
import { apiFetch } from "@/lib/api";
import {
  type Listing,
  type MyBid,
  formatPrice,
  formatMsLeft,
  formatSellerTier,
  sellerTierIconSrc,
} from "@/lib/types";
import { useMsLeft } from "@/lib/useMsLeft";
import { usePokeCelebrations } from "./CelebrationWatcher";

const RIBBON_MS = 1600;
const COLLAPSE_MS = 350;

// How far (as a % of the card's own width) a non-current photo sits from
// dead center — purely to give the slide-out/slide-in motion somewhere to
// travel from/to while it fades. Unlike ListingRow's search-results
// carousel, nothing here ever sits at a nonzero opacity at rest — no
// tucked-behind "ghost" peek of the next photo, per product decision (this
// card is small enough that a peek would just look cramped). Only the
// current photo (offset 0) is ever visible; every other offset is
// invisible both before and after the transition, so the only thing
// that's ever seen is the transition itself: the outgoing photo sliding
// out while fading, the incoming one sliding in while fading up.
const CAROUSEL_SHIFT_PCT = 35;

type EndPhase = "live" | "ribbon" | "collapsing";

export default function ListingCard({
  listing,
  initialWatching = false,
  isLoggedIn = false,
  myBid,
  removeOnEnd = false,
  onEnded,
}: {
  listing: Listing;
  initialWatching?: boolean;
  isLoggedIn?: boolean;
  myBid?: MyBid;
  // Opt-in: plays the "Ended" ribbon + fade-collapse and calls onEnded once
  // this card's own live countdown reaches zero. Only meant for grids of
  // currently-active listings (ListingSection) — pages that intentionally
  // keep showing already-ended auctions forever (Buying/Selling history)
  // should leave this off.
  removeOnEnd?: boolean;
  onEnded?: () => void;
}) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [busy, setBusy] = useState(false);
  const msLeft = useMsLeft(listing.endsAt);

  const photos = listing.imageUrls ?? [];
  const hasCarousel = photos.length > 1;
  const [photoIndex, setPhotoIndex] = useState(0);
  const [hovered, setHovered] = useState(false);

  // Same hover-gated arrow-key nav as ListingRow's search-results carousel
  // — only listens while the mouse is actually over this card (the same
  // condition that reveals the arrow buttons via group-hover below), so
  // arrow keys on a page full of cards always drive whichever one you're
  // pointing at, not a hidden "last card" a screen never showed feedback
  // for.
  useEffect(() => {
    if (!hovered || !hasCarousel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setPhotoIndex((i) => (i + 1) % photos.length);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPhotoIndex((i) => (i - 1 + photos.length) % photos.length);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hovered, hasCarousel, photos.length]);

  // Same shortest-signed-distance-with-wraparound offset math as
  // ListingRow's carousel — only the visual treatment of a nonzero offset
  // differs (see CAROUSEL_SHIFT_PCT above).
  const offsets = useMemo(() => {
    const n = photos.length;
    if (n === 0) return [];
    return photos.map((_, i) => {
      let diff = (((i - photoIndex) % n) + n) % n;
      if (diff > n / 2) diff -= n;
      return diff;
    });
  }, [photos, photoIndex]);

  // Same "jump more than one slot at once fades instead of sliding the
  // long way across" fix as ListingRow, using the same ref-free "adjust
  // state during render" pattern.
  const [prevOffsets, setPrevOffsets] = useState(offsets);
  const isJump = offsets.map((o, i) => Math.abs(o - (prevOffsets[i] ?? o)) > 1.5);
  if (offsets !== prevOffsets) {
    setPrevOffsets(offsets);
  }

  // outcome getting set (cmd/worker's close pass, or a Buy It Now
  // purchase — internal/auction/buynow.go) is what actually means "this
  // auction is over," not just its originally-scheduled end time: a Buy
  // It Now purchase closes an auction before its clock runs out, and
  // msLeft alone can't see that. Without this, a card for an auction
  // someone else already bought outright kept showing a live countdown
  // and a working Buy It Now button — same bug already fixed for Bids/
  // Offers (lib/types.ts's hasBidEnded), just here too, since ListingCard
  // is what every grid on the site (homepage, Selling, watchlist, seller
  // profile) actually renders.
  const hasEnded =
    listing.format === "auction" && (Boolean(listing.outcome) || (msLeft !== null && msLeft <= 0));
  const isUrgent =
    listing.format === "auction" && !hasEnded && msLeft !== null && msLeft > 0 && msLeft <= 60 * 60 * 1000;

  // Only animate the transition into "ended" — a card that's already
  // ended the moment it first mounts (shouldn't happen where removeOnEnd
  // is set, since those grids only ever hold active listings, but is the
  // normal case everywhere else) just renders as ended, no ribbon. Plain
  // useState rather than a ref: its initial-render value is exactly the
  // "was it already ended at mount" snapshot we want, and reading state
  // during render (unlike a ref) is always safe.
  const [alreadyEndedAtMount] = useState(hasEnded);
  const [phase, setPhase] = useState<EndPhase>("live");

  // Adjusted during render rather than in an effect (React's documented
  // pattern for "state driven by another value changing") — msLeft
  // ticks down via useMsLeft's own interval, and the moment it crosses
  // zero this flips phase exactly once (the phase === "live" guard makes
  // it self-stabilizing, so it never loops).
  if (removeOnEnd && phase === "live" && !alreadyEndedAtMount && msLeft !== null && msLeft <= 0) {
    setPhase("ribbon");
  }

  useEffect(() => {
    if (phase === "ribbon") {
      const t = setTimeout(() => setPhase("collapsing"), RIBBON_MS);
      return () => clearTimeout(t);
    }
    if (phase === "collapsing") {
      const t = setTimeout(() => onEnded?.(), COLLAPSE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, onEnded]);

  // Independent of removeOnEnd/the ribbon — every card, everywhere it
  // renders (homepage, Buying, Selling, seller profile), pokes the
  // celebration watcher the instant its own countdown reaches zero, so
  // whoever's actually looking at their auction end sees "Bid Won!"/"Item
  // Sold!" immediately rather than waiting for the next scheduled poll.
  const poke = usePokeCelebrations();
  const hasPoked = useRef(false);
  useEffect(() => {
    if (alreadyEndedAtMount || hasPoked.current) return;
    if (msLeft !== null && msLeft <= 0) {
      hasPoked.current = true;
      poke();
    }
  }, [msLeft, alreadyEndedAtMount, poke]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative flex flex-col overflow-hidden rounded-xl border border-brand-border bg-white transition-shadow hover:shadow-md ${
        phase === "collapsing" ? "animate-card-fade-collapse" : ""
      }`}
    >
      {(phase === "ribbon" || phase === "collapsing") && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
          <div className="w-[150%] animate-ended-ribbon bg-brand-urgent py-1.5 text-center text-sm font-extrabold uppercase tracking-wider text-white shadow-lg">
            Ended
          </div>
        </div>
      )}

      <Link
        href={`/listing/${listing.id}`}
        className="relative block aspect-[4/5] overflow-hidden"
      >
        {hasCarousel ? (
          <div className="relative h-full w-full transition-transform duration-300 group-hover:scale-105">
            {photos.map((url, i) => {
              const offset = offsets[i];
              return (
                <div
                  key={url}
                  className="absolute inset-0"
                  style={{
                    transform: `translateX(${offset * CAROUSEL_SHIFT_PCT}%)`,
                    opacity: offset === 0 ? 1 : 0,
                    zIndex: offset === 0 ? 10 : 0,
                    transitionProperty: isJump[i] ? "opacity" : "transform, opacity",
                    transitionDuration: "380ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    pointerEvents: "none",
                  }}
                >
                  <ListingImage src={url} game={listing.game} label={listing.title} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full w-full transition-transform duration-300 group-hover:scale-105">
            <ListingImage src={photos[0]} game={listing.game} label={listing.title} />
          </div>
        )}

        {hasCarousel && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setPhotoIndex((i) => (i - 1 + photos.length) % photos.length);
              }}
              aria-label="Previous photo"
              className="absolute left-1.5 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setPhotoIndex((i) => (i + 1) % photos.length);
              }}
              aria-label="Next photo"
              className="absolute right-1.5 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
            >
              <ChevronRight size={16} />
            </button>

            <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 gap-1 opacity-40 transition-opacity group-hover:opacity-100">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full border-[0.5px] border-black ${
                    i === photoIndex ? "bg-brand-gold" : "bg-white"
                  }`}
                />
              ))}
            </div>
          </>
        )}

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
              <p className="text-[11px] text-gray-500">{hasEnded ? "Final price" : "Current bid"}</p>
              <p className={`text-lg font-bold ${hasEnded ? "text-brand-urgent" : "text-gray-900"}`}>
                {formatPrice(listing.currentPriceCents ?? 0)}
              </p>
              <p className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{listing.bidCount ?? 0} bids</span>
                <span
                  className={isUrgent ? "font-semibold text-brand-urgent" : "text-gray-500"}
                  // The server renders this at request time; hydration
                  // happens a moment (often ~1s) later, so the two
                  // Date.now()-derived countdown strings almost never
                  // match exactly. suppressHydrationWarning is React's
                  // documented escape hatch for exactly this "ticking
                  // clock" case — useMsLeft's own interval corrects the
                  // one-second discrepancy within its next tick anyway.
                  suppressHydrationWarning
                >
                  {hasEnded ? "Ended" : msLeft !== null ? formatMsLeft(msLeft) : ""}
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
              {listing.buyItNowPriceCents && !hasEnded && isLoggedIn && (
                <div className="mt-2">
                  <BuyNowButton
                    listingId={listing.id}
                    priceCents={listing.buyItNowPriceCents}
                    label={`Buy It Now for ${formatPrice(listing.buyItNowPriceCents)}`}
                  />
                </div>
              )}
            </div>
          ) : (
            <div>
              <p
                className={`text-lg font-bold ${listing.buyerId ? "text-brand-urgent" : "text-gray-900"}`}
              >
                {formatPrice(listing.priceCents ?? 0)}
              </p>
              <p className="text-xs text-gray-500">
                {listing.freeShipping
                  ? "Free shipping"
                  : `+${formatPrice(listing.shippingCostCents)} shipping`}
              </p>
              {listing.buyerId ? (
                <p className="mt-2 text-xs font-semibold text-gray-500">Sold</p>
              ) : isLoggedIn ? (
                <div className="mt-2">
                  <BuyNowButton listingId={listing.id} priceCents={listing.priceCents ?? 0} />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-1.5 border-t border-brand-border pt-2 text-[11px] text-gray-500">
          {listing.sellerUsername ? (
            <Link
              href={`/seller/${listing.sellerUsername}`}
              className="min-w-0 flex-1 truncate hover:text-brand-navy hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {listing.sellerUsername}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate">Seller</span>
          )}
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-surface px-1.5 py-0.5 font-medium text-gray-600">
            {sellerTierIconSrc(listing.sellerTier) ? (
              <Image src={sellerTierIconSrc(listing.sellerTier)!} alt="" width={11} height={11} unoptimized />
            ) : (
              <ShieldCheck size={10} />
            )}
            {formatSellerTier(listing.sellerTier)}
          </span>
        </div>
      </div>
    </div>
  );
}
