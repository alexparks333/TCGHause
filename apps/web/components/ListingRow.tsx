"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Zap, Check, ChevronLeft, ChevronRight, Truck, ShieldCheck } from "lucide-react";
import CardArt from "./CardArt";
import BuyNowButton from "./BuyNowButton";
import Avatar from "./Avatar";
import StarRating from "./StarRating";
import { apiFetch } from "@/lib/api";
import {
  type Listing,
  type MyBid,
  formatPrice,
  formatMsLeft,
  formatSellerTier,
  listingSoldAt,
  sellerTierIconSrc,
  shippingDisplayText,
} from "@/lib/types";
import { formatDateTime, formatCompactCount } from "@/lib/format";
import { useMsLeft } from "@/lib/useMsLeft";

// eBay-style search-results row: a contained, single-photo carousel on the
// left (arrow buttons, dots, and hover + arrow keys all slide to the next
// photo), bid/buy-it-now info on the right — one per line, scroll for more.
// Used only for search results (ListingSection's layout="row"); everywhere
// else (homepage sections, "More from this seller") stays the card grid via
// ListingCard.

// The carousel's photo cards are 75% of the box's width (CARD_PCT below),
// same as a non-carousel single photo — kept identical so photo count
// doesn't change how big the "main" image reads. Deliberately large (not a
// marginal bump from a 46% starting point) so the card fills its column
// instead of floating in a wide empty stage — the stage itself is only
// there anymore to give the tucked-behind peek somewhere to sit, not to
// host a separate side-by-side photo. CARD_CENTER_PCT is the translateX
// (as a % of the card's OWN width, since that's what CSS transform
// percentages are relative to) that lands a card dead center in the box:
// centering it means shifting its left edge from 0 to (100 - CARD_PCT) / 2
// of the box, then re-expressing that box-relative distance as a fraction
// of the card's own width.
const CARD_PCT = 75;
const CARD_CENTER_PCT = (((100 - CARD_PCT) / 2 / CARD_PCT) * 100);
// How far (as a % of the card's own width) the peek shifts right from
// dead center — small, so the next photo reads as tucked directly behind
// the main card rather than sitting beside it as its own card, but wide
// enough that its sliver is clearly visible past the main card's right
// edge (per product feedback on the first pass being too subtle). No
// vertical shift — the peek stays vertically centered on the main card,
// only offset horizontally, so it doesn't read as sitting low/behind-below.
const CARD_TUCK_X_PCT = 22;
const CARD_TUCK_Y_PCT = 0;

export default function ListingRow({
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
  const msLeft = useMsLeft(listing.endsAt);

  const photos = listing.imageUrls ?? [];
  const hasPhotos = photos.length > 0;
  const hasCarousel = photos.length > 1;
  const [photoIndex, setPhotoIndex] = useState(0);
  const [hovered, setHovered] = useState(false);

  // Shortest signed "slot" distance from photoIndex to photo i, wrapping
  // around the array — 0 is dead center, +1 is the peek slot on the
  // right, -1 is its mirror on the left (kept in the DOM at opacity 0,
  // purely so a "previous" click has somewhere to visually arrive from).
  // Recomputed fresh every render, so a photo's position is always a pure
  // function of (its index, photoIndex) rather than tracked separately.
  const offsets = useMemo(() => {
    const n = photos.length;
    return photos.map((_, i) => {
      let diff = (((i - photoIndex) % n) + n) % n;
      if (diff > n / 2) diff -= n;
      return diff;
    });
  }, [photos, photoIndex]);

  // With 3+ photos, the slot opposite the current photo can flip from -1
  // to +1 (or back) in a single click — e.g. advancing from photo A to B
  // can simultaneously require photo C to jump from "hidden behind on the
  // left" to "peeking on the right". Sliding it the long way across the
  // center would read as a glitch, not a carousel, so anything that jumps
  // more than one slot in a single update fades in/out at its new
  // position instead of animating the move.
  //
  // isJump compares this render's offsets against the previous render's,
  // via React's documented "adjust state during rendering" pattern (same
  // one AuctionPriceBox.tsx uses for prevListing/live) rather than reading
  // a ref's .current in the render body — refs aren't guaranteed stable
  // across renders that don't commit (e.g. Strict Mode's double-invoke),
  // so reading one during render is a real (lint-flagged) bug, not just
  // style. offsets is only a new array reference when photos/photoIndex
  // actually change (it's memoized above), so this only re-syncs — and
  // only ever computes isJump against a genuinely stale value — right
  // when there's something to compare.
  const [prevOffsets, setPrevOffsets] = useState(offsets);
  const isJump = offsets.map((o, i) => Math.abs(o - (prevOffsets[i] ?? o)) > 1.5);
  if (offsets !== prevOffsets) {
    setPrevOffsets(offsets);
  }

  // Arrow keys only drive whichever row's image the mouse is actually
  // over — a plain onKeyDown on the row itself would need every row
  // tab-focused first, which isn't how a scrolling results list gets used.
  useEffect(() => {
    if (!hovered || photos.length <= 1) return;
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
  }, [hovered, photos.length]);

  // Same outcome-vs-clock check as ListingCard — a Buy It Now purchase (or
  // the worker's close pass) can end an auction before its scheduled
  // endsAt, so `outcome` always wins over a stale countdown.
  const hasEnded =
    listing.format === "auction" && (Boolean(listing.outcome) || (msLeft !== null && msLeft <= 0));
  const isUrgent =
    listing.format === "auction" && !hasEnded && msLeft !== null && msLeft > 0 && msLeft <= 60 * 60 * 1000;
  // Undefined for an auction that ended with no bids — see listingSoldAt's
  // own doc for why that must never render a sale date.
  const soldAt = listingSoldAt(listing);

  return (
    <div className="grid grid-cols-4 items-center gap-5 border-b border-brand-border py-3 last:border-b-0 sm:gap-10">
      <div
        className="col-span-1 flex items-center justify-center"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Link
          href={`/listing/${listing.id}`}
          className={
            hasCarousel
              ? // Stage height derives from CARD_PCT the same way the width
                // does — at CARD_PCT=75 the card's own height (75% width *
                // 4/3 aspect) exactly equals the stage's width, so a square
                // stage is what makes the card fill its box with (near-)zero
                // vertical padding too, not just horizontal. (General
                // formula: stage aspect = 75 / CARD_PCT.)
                "group relative aspect-square w-full shrink-0 overflow-hidden"
              : "group relative aspect-[3/4] w-[75%] shrink-0 overflow-hidden rounded-lg border border-brand-border bg-white"
          }
        >
          {hasCarousel ? (
            // Every photo stays mounted the whole time, absolutely stacked,
            // and positioned purely via transform (translateX/Y + scale)
            // and opacity — never width/left/top — so the browser can
            // animate the move instead of jump-cutting between two static
            // boxes. At rest: offset 0 sits dead center in this box (scale
            // 1, opacity 1, on top); offset 1 is tucked mostly behind it,
            // just a sliver visible past its right/bottom edge (scale .85,
            // opacity .4, lower z-index); everything else fades to
            // invisible, still contained by this box's own overflow-hidden
            // so nothing spills into the info column.
            photos.map((url, i) => {
              const offset = offsets[i];
              return (
                <div
                  key={url}
                  className={`absolute left-0 top-1/2 w-[75%] aspect-[3/4] overflow-hidden rounded-lg border border-brand-border bg-white ${
                    offset === 0 ? "shadow-xl" : ""
                  }`}
                  style={{
                    transform: `translateY(calc(-50% + ${
                      offset === 0 ? 0 : CARD_TUCK_Y_PCT
                    }%)) translateX(${CARD_CENTER_PCT + offset * CARD_TUCK_X_PCT}%) scale(${
                      offset === 0 ? 1 : 0.85
                    })`,
                    opacity: offset === 0 ? 1 : offset === 1 ? 0.4 : 0,
                    zIndex: offset === 0 ? 30 : Math.abs(offset) === 1 ? 20 : 10,
                    transitionProperty: isJump[i] ? "opacity" : "transform, opacity",
                    transitionDuration: "380ms",
                    // A gentle, overshoot-free deceleration curve — starts
                    // fast and eases into place, reading as one continuous,
                    // weighted motion rather than a linear slide. Close to
                    // how iOS springs its card/photo transitions.
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    pointerEvents: offset === 0 ? "auto" : "none",
                  }}
                >
                  <Image
                    src={url}
                    alt={offset === 0 ? listing.title : ""}
                    fill
                    className="object-contain"
                  />
                </div>
              );
            })
          ) : hasPhotos ? (
            <div className="relative h-full w-full">
              <Image src={photos[0]} alt={listing.title} fill className="object-contain" />
            </div>
          ) : (
            <CardArt game={listing.game} label={listing.title} />
          )}

          {/* The main card is centered in this box (not flush against its
              left edge), so every control below anchors to CARD_EDGE_PCT —
              the % inset of the main card's own left/right edge from the
              box's edge — instead of the box's own corners. */}
          {listing.format !== "auction" && (
            <span className="absolute left-[calc(12.5%+0.5rem)] top-2 z-40 inline-flex items-center gap-1 rounded-full bg-brand-success px-2.5 py-1.5 text-xs font-semibold text-white">
              <Zap size={14} /> Buy It Now
            </span>
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
                className="absolute left-[calc(12.5%-0.5rem)] top-1/2 z-40 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-75"
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
                className="absolute right-[calc(12.5%-0.5rem)] top-1/2 z-40 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-75"
              >
                <ChevronRight size={16} />
              </button>

              {/* The main card is now centered in the box, so its own
                  horizontal center coincides with the box's — no offset
                  math needed here, unlike the edge-anchored controls above. */}
              <div className="pointer-events-none absolute bottom-2 left-1/2 z-40 flex -translate-x-1/2 gap-1 opacity-40 transition-opacity group-hover:opacity-100">
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className={`h-2.5 w-2.5 rounded-full border-[0.5px] border-black ${
                      i === photoIndex ? "bg-brand-gold" : "bg-white"
                    }`}
                  />
                ))}
              </div>
            </>
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
            className={`absolute top-2 z-40 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors hover:bg-white disabled:opacity-60 ${
              hasCarousel ? "right-[calc(12.5%+0.5rem)]" : "right-2"
            }`}
          >
            <Heart
              size={16}
              className={watching ? "fill-brand-urgent text-brand-urgent" : "text-gray-500"}
            />
          </button>
        </Link>
      </div>

      <div className="col-span-3 flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-wide text-brand-gold">
              {listing.game}
            </p>
            <Link href={`/listing/${listing.id}`}>
              <h3 className="text-lg font-semibold text-gray-900 hover:underline sm:text-xl">
                {listing.title}
              </h3>
            </Link>
            <p className="mt-0.5 text-sm text-gray-500 sm:text-base">
              {listing.set}
              {listing.isGraded
                ? ` · ${listing.gradingCompany} ${listing.grade}`
                : ` · ${listing.condition}`}
            </p>
          </div>

          {/* Buy It Now button, up top where it's immediately reachable —
              the price itself still shows down with the rest of the price
              info below. */}
          {listing.format === "fixed" ? (
            listing.buyerId ? (
              <p className="shrink-0 text-base font-semibold text-gray-900">
                Sold{soldAt ? ` ${formatDateTime(soldAt)}` : ""}
              </p>
            ) : isLoggedIn ? (
              <div className="shrink-0">
                <BuyNowButton listingId={listing.id} priceCents={listing.priceCents ?? 0} />
              </div>
            ) : null
          ) : (
            listing.buyItNowPriceCents &&
            !hasEnded &&
            isLoggedIn && (
              <div className="shrink-0">
                <BuyNowButton
                  listingId={listing.id}
                  priceCents={listing.buyItNowPriceCents}
                  label="Buy It Now"
                />
              </div>
            )
          )}
        </div>

        <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-500 sm:text-base">
          <Truck size={15} />
          {shippingDisplayText(listing)}
        </p>

        <div className="mt-2 flex w-fit items-center gap-2 rounded-full bg-gray-200 py-1 pl-1 pr-3">
          {listing.sellerUsername ? (
            // Avatar + name as one click target, not just the text — a
            // profile picture next to a name reads as clickable.
            <Link
              href={`/seller/${listing.sellerUsername}`}
              className="group flex items-center gap-2"
            >
              <Avatar label={listing.sellerUsername} size={24} />
              <span className="text-sm font-medium text-gray-700 group-hover:text-brand-navy group-hover:underline">
                {listing.sellerUsername}
              </span>
            </Link>
          ) : (
            <>
              <Avatar label="Seller" size={24} />
              <span className="text-sm font-medium text-gray-700">Seller</span>
            </>
          )}
          <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-600">
            {sellerTierIconSrc(listing.sellerTier) ? (
              <Image src={sellerTierIconSrc(listing.sellerTier)!} alt="" width={13} height={13} unoptimized />
            ) : (
              <ShieldCheck size={12} />
            )}
            {formatSellerTier(listing.sellerTier)}
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <StarRating
              rating={listing.sellerRatingAvg}
              size={12}
              filledClassName="fill-orange-500 text-black"
              emptyClassName="fill-transparent text-black"
            />
            {listing.sellerReviewCount > 0
              ? `${listing.sellerRatingAvg.toFixed(1)} (${formatCompactCount(listing.sellerReviewCount)})`
              : "No reviews yet"}
          </span>
        </div>

        {listing.format === "auction" && (
          <div className="mt-4 flex flex-wrap items-start gap-x-7 gap-y-4">
            <div>
              <p className="text-xs text-gray-500">{hasEnded ? "Final price" : "Current bid"}</p>
              <p
                className={`text-2xl font-bold sm:text-3xl ${
                  hasEnded ? "text-brand-urgent" : "text-gray-900"
                }`}
              >
                {formatPrice(listing.currentPriceCents ?? 0)}
              </p>
              <p className="mt-0.5 text-sm text-gray-500">
                {listing.bidCount ?? 0} bids ·{" "}
                <span
                  className={isUrgent ? "font-semibold text-brand-urgent" : ""}
                  suppressHydrationWarning
                >
                  {hasEnded ? "Ended" : msLeft !== null ? formatMsLeft(msLeft) : ""}
                </span>
              </p>
              {soldAt && (
                <p className="mt-0.5 text-base font-semibold text-gray-900">
                  Sold {formatDateTime(soldAt)}
                </p>
              )}
              {myBid && myBid.status === "winning" && !hasEnded && (
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-brand-success">
                  <Check size={14} /> Winning
                </p>
              )}
            </div>
            {listing.buyItNowPriceCents && !hasEnded && (
              <div>
                <p className="text-xs text-gray-500">Buy It Now</p>
                <p className="text-2xl font-bold text-gray-900 sm:text-3xl">
                  {formatPrice(listing.buyItNowPriceCents)}
                </p>
              </div>
            )}
          </div>
        )}

        {listing.format === "fixed" && (
          <p
            className={`mt-4 text-2xl font-bold sm:text-3xl ${
              listing.buyerId ? "text-brand-urgent" : "text-gray-900"
            }`}
          >
            {formatPrice(listing.soldPriceCents ?? listing.priceCents ?? 0)}
          </p>
        )}
      </div>
    </div>
  );
}
