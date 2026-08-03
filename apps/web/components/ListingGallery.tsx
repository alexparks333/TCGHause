"use client";

import { useState } from "react";
import Image from "next/image";
import CardArt from "./CardArt";
import WatchBadge from "./WatchBadge";
import type { Game } from "@/lib/types";

// Real uploaded photos, clickable thumbnails swapping the main viewer.
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
  const hasPhotos = imageUrls.length > 0;

  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 sm:grid-cols-[100px_1fr]">
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

      <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-brand-border">
        {hasPhotos ? (
          <Image src={imageUrls[selected]} alt={title} fill className="object-cover" />
        ) : (
          <CardArt game={game} label={title} />
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
