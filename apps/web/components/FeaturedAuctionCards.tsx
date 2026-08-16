"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import ListingImage from "./ListingImage";
import { formatPrice, type Listing } from "@/lib/types";

// How far (in px) the peek shifts from dead center, and how much smaller/
// fainter it reads — matches the original fixed -right-24/top-6/w-48-of-
// w-64/opacity-[0.65] peek exactly, just reached via transform now instead
// of a second hardcoded decorative element.
const PEEK_X = 96;
const PEEK_Y = 24;
const PEEK_SCALE = 0.75;
const PEEK_OPACITY = 0.65;

// The hero's featured carousel — real auctions ranked by real watcher count
// (never fabricated placement), never the static gradient mockups this used
// to render. `listings` is expected pre-sorted by watcherCount desc and
// already filtered to format === "auction" by the caller (app/page.tsx).
//
// Every card stays mounted the whole time, absolutely stacked, positioned
// purely via transform (translate + scale) and opacity — same technique as
// ListingRow's search-results photo carousel — so advancing (autoplay,
// arrows, or a dot) animates as one continuous glide instead of the old
// version's instant current/next swap.
export default function FeaturedAuctionCards({ listings }: { listings: Listing[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (listings.length < 2 || paused) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % listings.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [listings.length, paused]);

  // Shortest signed "slot" distance from index to listing i, wrapping
  // around the array — 0 is dead center, +1 is the peek slot tucked
  // behind-right, everything else fades to invisible. Recomputed fresh
  // every render, so a card's position is always a pure function of (its
  // index, the current index) rather than tracked separately.
  const offsets = useMemo(() => {
    const n = listings.length;
    if (n === 0) return [];
    return listings.map((_, i) => {
      let diff = (((i - index) % n) + n) % n;
      if (diff > n / 2) diff -= n;
      return diff;
    });
  }, [listings, index]);

  // With 3+ featured auctions, the slot opposite the current one can flip
  // from -1 to +1 (or back) in a single step — same "jump the long way
  // across the center would look like a glitch" case ListingRow handles,
  // fixed the same way: anything that jumps more than one slot fades in/
  // out at its new position instead of animating the move. Uses React's
  // "adjust state during render" pattern (comparing this render's offsets
  // against a state snapshot of the last one) rather than reading a ref's
  // .current in the render body, which React flags as unsafe/unreliable
  // across renders that don't commit.
  const [prevOffsets, setPrevOffsets] = useState(offsets);
  const isJump = offsets.map((o, i) => Math.abs(o - (prevOffsets[i] ?? o)) > 1.5);
  if (offsets !== prevOffsets) {
    setPrevOffsets(offsets);
  }

  if (listings.length === 0) return null;

  function go(delta: number) {
    setIndex((i) => (i + delta + listings.length) % listings.length);
  }

  return (
    <div
      className="hidden flex-col items-center gap-4 lg:flex"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative z-0 aspect-[5/7] w-64">
        {listings.map((listing, i) => {
          const offset = offsets[i];
          const isCenter = offset === 0;
          const card = (
            <>
              <ListingImage src={listing.imageUrls?.[0]} game={listing.game} label={listing.title} />
              {isCenter && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pt-14">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-brand-gold-light">
                    {listing.game}
                  </p>
                  <p className="line-clamp-1 text-sm font-semibold text-white">{listing.title}</p>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-white/85">
                    <span className="flex items-center gap-1">
                      <Heart size={12} className="fill-brand-urgent text-brand-urgent" />
                      {listing.watcherCount} watching
                    </span>
                    <span className="text-sm font-bold text-brand-gold-light">
                      {formatPrice(listing.currentPriceCents ?? 0)}
                    </span>
                  </div>
                </div>
              )}
            </>
          );

          return (
            <div
              key={listing.id}
              className={`absolute inset-0 overflow-hidden rounded-2xl ${
                isCenter ? "shadow-2xl ring-1 ring-white/15" : "shadow-xl ring-1 ring-white/10"
              }`}
              style={{
                transform: `translate(${offset * PEEK_X}px, ${
                  offset === 0 ? 0 : offset > 0 ? PEEK_Y : -PEEK_Y
                }px) scale(${offset === 0 ? 1 : PEEK_SCALE})`,
                opacity: offset === 0 ? 1 : offset === 1 ? PEEK_OPACITY : 0,
                zIndex: offset === 0 ? 30 : Math.abs(offset) === 1 ? 10 : 0,
                transitionProperty: isJump[i] ? "opacity" : "transform, opacity",
                transitionDuration: "380ms",
                // Same gentle, overshoot-free deceleration curve as the
                // search-results carousel — starts fast, eases into place,
                // reads as one continuous glide rather than a linear slide.
                transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                pointerEvents: isCenter ? "auto" : "none",
              }}
            >
              {isCenter ? (
                <Link
                  href={`/listing/${listing.id}`}
                  className="block h-full w-full transition-transform duration-300 hover:scale-[1.02]"
                >
                  {card}
                </Link>
              ) : (
                <div aria-hidden className="h-full w-full">
                  {card}
                </div>
              )}
            </div>
          );
        })}

        {listings.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous featured auction"
              className="absolute left-2 top-1/2 z-40 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-brand-navy shadow-md backdrop-blur transition-colors hover:bg-white"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next featured auction"
              className="absolute right-2 top-1/2 z-40 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-brand-navy shadow-md backdrop-blur transition-colors hover:bg-white"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      {listings.length > 1 && (
        <div className="flex items-center gap-2">
          {listings.map((l, i) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show featured auction ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-6 bg-brand-gold" : "w-1.5 bg-white/30 hover:bg-white/50"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
