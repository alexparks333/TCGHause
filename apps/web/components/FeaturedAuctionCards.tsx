"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import ListingImage from "./ListingImage";
import { formatPrice, type Listing } from "@/lib/types";

// The hero's featured carousel — real auctions ranked by real watcher count
// (never fabricated placement), never the static gradient mockups this used
// to render. `listings` is expected pre-sorted by watcherCount desc and
// already filtered to format === "auction" by the caller (app/page.tsx).
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

  if (listings.length === 0) return null;

  const current = listings[index % listings.length];
  const next = listings.length > 1 ? listings[(index + 1) % listings.length] : null;

  function go(delta: number) {
    setIndex((i) => (i + delta + listings.length) % listings.length);
  }

  return (
    <div
      className="hidden flex-col items-center gap-4 lg:flex"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative z-0 w-64">
        {/* A faded peek of what's next, tucked behind-right of the main
            card — purely decorative (not clickable, no id changes on
            click) so it reads as "up next" without a second interactive
            target competing with the arrows/dots. */}
        {next && (
          <div
            aria-hidden
            className="absolute -right-24 top-6 -z-10 aspect-[5/7] w-48 overflow-hidden rounded-2xl opacity-[0.65] shadow-xl ring-1 ring-white/10"
          >
            <ListingImage src={next.imageUrls?.[0]} game={next.game} label={next.title} />
          </div>
        )}

        <Link
          href={`/listing/${current.id}`}
          className="relative z-10 block overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/15 transition-transform duration-300 hover:scale-[1.02]"
        >
          <div className="relative aspect-[5/7] w-full">
            <ListingImage src={current.imageUrls?.[0]} game={current.game} label={current.title} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pt-14">
              <p className="text-[11px] font-medium uppercase tracking-wide text-brand-gold-light">
                {current.game}
              </p>
              <p className="line-clamp-1 text-sm font-semibold text-white">{current.title}</p>
              <div className="mt-1.5 flex items-center justify-between text-xs text-white/85">
                <span className="flex items-center gap-1">
                  <Heart size={12} className="fill-brand-urgent text-brand-urgent" />
                  {current.watcherCount} watching
                </span>
                <span className="text-sm font-bold text-brand-gold-light">
                  {formatPrice(current.currentPriceCents ?? 0)}
                </span>
              </div>
            </div>
          </div>
        </Link>

        {listings.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous featured auction"
              className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-brand-navy shadow-md backdrop-blur transition-colors hover:bg-white"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next featured auction"
              className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-brand-navy shadow-md backdrop-blur transition-colors hover:bg-white"
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
