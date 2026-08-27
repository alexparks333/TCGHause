"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import CardArt from "./CardArt";
import WatchBadge from "./WatchBadge";
import type { Game } from "@/lib/types";

// How far (as a % of the viewer's own width) a non-current photo sits from
// dead center — same "slide + fade, no ghosting peek" treatment as
// ListingCard's carousel: only the current photo (offset 0) is ever
// visible, every other offset stays at opacity 0 both before and after a
// transition, so all that's ever seen is the transition itself.
const CAROUSEL_SHIFT_PCT = 35;

// Real uploaded photos, clickable thumbnails swapping the main viewer —
// selected is shared between the thumbnails and the main viewer's own
// arrow buttons, so either one smoothly animates the same transition.
// Falls back to the gradient placeholder only for listings with no photos
// (shouldn't happen for anything created after CLAUDE.md §6.13, since the
// Sell wizard requires at least front+back — this is just a safety net).
export default function ListingGallery({
  listingId,
  imageUrls,
  watcherCount,
  initialWatching,
  isLoggedIn,
  game,
  title,
}: {
  listingId: string;
  imageUrls: string[];
  watcherCount: number;
  initialWatching: boolean;
  isLoggedIn: boolean;
  game: Game;
  title: string;
}) {
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState(false);
  const hasPhotos = imageUrls.length > 0;
  const hasCarousel = imageUrls.length > 1;

  // Same hover-gated arrow-key nav as ListingCard/ListingRow's carousels —
  // this was missing here, which is why arrow keys worked on the grid
  // cards but not once you'd actually clicked into a listing's own page.
  useEffect(() => {
    if (!hovered || !hasCarousel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelected((i) => (i + 1) % imageUrls.length);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected((i) => (i - 1 + imageUrls.length) % imageUrls.length);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hovered, hasCarousel, imageUrls.length]);

  // Same shortest-signed-distance-with-wraparound offset math as
  // ListingCard/ListingRow's carousels.
  const offsets = useMemo(() => {
    const n = imageUrls.length;
    if (n === 0) return [];
    return imageUrls.map((_, i) => {
      let diff = (((i - selected) % n) + n) % n;
      if (diff > n / 2) diff -= n;
      return diff;
    });
  }, [imageUrls, selected]);

  // Same "a jump of more than one slot fades instead of sliding the long
  // way across" fix as the other carousels, via the same ref-free "adjust
  // state during render" pattern (reading a ref's .current in the render
  // body is unsafe/unreliable across renders that don't commit).
  const [prevOffsets, setPrevOffsets] = useState(offsets);
  const isJump = offsets.map((o, i) => Math.abs(o - (prevOffsets[i] ?? o)) > 1.5);
  if (offsets !== prevOffsets) {
    setPrevOffsets(offsets);
  }

  return (
    // 1.5x the old max-w-xl (576px -> 864px... actually 48rem) — deliberately
    // capped, not full-width: the page's own grid column sizes itself to
    // match this (see app/listing/[id]/page.tsx's grid-cols), so the gap
    // to the price box is closed by giving THAT column the leftover space,
    // not by stretching this photo past its intended size. The thumbnail
    // column stays a fixed 80/100px either way, so all the extra width
    // goes straight into the main viewer via its 1fr grid column.
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="grid max-w-[48rem] grid-cols-[80px_1fr] gap-3 sm:grid-cols-[100px_1fr]"
    >
      <div className="hidden flex-col gap-2 sm:flex">
        {hasPhotos ? (
          imageUrls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setSelected(i)}
              className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                selected === i
                  ? "border-brand-navy"
                  : "border-transparent hover:border-brand-border"
              }`}
            >
              <Image src={url} alt={`${title} photo ${i + 1}`} fill className="object-cover" />
            </button>
          ))
        ) : (
          <div className="h-20 w-20 overflow-hidden rounded-lg border border-brand-border">
            <CardArt game={game} label={title} />
          </div>
        )}
      </div>

      <div className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-brand-border">
        {hasCarousel ? (
          imageUrls.map((url, i) => {
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
                <Image src={url} alt={`${title} photo ${i + 1}`} fill className="object-cover" />
              </div>
            );
          })
        ) : hasPhotos ? (
          <Image src={imageUrls[0]} alt={title} fill className="object-cover" />
        ) : (
          <CardArt game={game} label={title} />
        )}

        {hasCarousel && (
          <>
            <button
              type="button"
              onClick={() => setSelected((i) => (i - 1 + imageUrls.length) % imageUrls.length)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => setSelected((i) => (i + 1) % imageUrls.length)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
            >
              <ChevronRight size={18} />
            </button>

            <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1.5 opacity-40 transition-opacity group-hover:opacity-100">
              {imageUrls.map((_, i) => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-full border-[0.5px] border-black ${
                    i === selected ? "bg-brand-gold" : "bg-white"
                  }`}
                />
              ))}
            </div>
          </>
        )}

        <WatchBadge
          listingId={listingId}
          initialCount={watcherCount}
          initialWatching={initialWatching}
          isLoggedIn={isLoggedIn}
        />
      </div>
    </div>
  );
}
