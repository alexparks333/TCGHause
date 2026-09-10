"use client";

import { useState } from "react";
import Link from "next/link";
import type { Listing, MyBid } from "@/lib/types";
import ListingCard from "./ListingCard";
import ListingRow from "./ListingRow";

export default function ListingSection({
  id,
  title,
  subtitle,
  items,
  watchedIds,
  isLoggedIn = false,
  currentUserId,
  myBidsByListingId,
  layout = "grid",
}: {
  id?: string;
  title: string;
  subtitle?: string;
  items: Listing[];
  watchedIds?: Set<string>;
  isLoggedIn?: boolean;
  // Threaded straight through to ListingCard (ListingRow has no offer
  // button, so it doesn't need this) — see ListingCard's own doc comment.
  currentUserId?: string;
  myBidsByListingId?: Map<string, MyBid>;
  // "row" is the eBay-style search-results view (image left, details right,
  // one per line) — used only for search results. Everywhere else
  // (homepage sections, "More from this seller") stays the card grid.
  layout?: "grid" | "row";
}) {
  // Client-managed copy of items so a card whose countdown hits zero can
  // remove itself (via onEnded) without waiting for a refresh — this is
  // what makes the grid actually reflow in real time instead of only
  // updating on next page load. Resyncs whenever the server gives fresh
  // props (new filter, new page load, router.refresh()), which is also
  // what naturally drops an item this tab didn't see end itself. Adjusted
  // during render (React's documented pattern for "reset state when a
  // prop changes") rather than in an effect, so there's no extra
  // post-commit render pass.
  const [prevItems, setPrevItems] = useState(items);
  const [visibleItems, setVisibleItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setVisibleItems(items);
  }

  return (
    <section id={id} className="py-4">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {layout === "grid" && (
          <Link href="#" className="text-sm font-medium text-brand-navy hover:underline">
            View all
          </Link>
        )}
      </div>
      {layout === "row" ? (
        <div className="flex flex-col rounded-xl border border-brand-border bg-white px-2 sm:px-2.5">
          {visibleItems.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              initialWatching={watchedIds?.has(listing.id) ?? false}
              isLoggedIn={isLoggedIn}
              myBid={myBidsByListingId?.get(listing.id)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visibleItems.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              initialWatching={watchedIds?.has(listing.id) ?? false}
              isLoggedIn={isLoggedIn}
              currentUserId={currentUserId}
              myBid={myBidsByListingId?.get(listing.id)}
              removeOnEnd
              onEnded={() =>
                setVisibleItems((prev) => prev.filter((l) => l.id !== listing.id))
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
