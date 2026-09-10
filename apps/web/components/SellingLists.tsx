"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Package, History, ChevronDown } from "lucide-react";
import ListingCard from "@/components/ListingCard";
import ModeButton from "@/components/ModeButton";
import type { Listing } from "@/lib/types";

// How many rows show before "Load More" — the grid itself is responsive
// (grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6), so "5 rows" is
// a moving target in item count, not a fixed number: ListingGrid measures
// its own actual rendered column count and multiplies by this.
const INITIAL_ROWS = 5;

type Mode = "active" | "history";

// Every listing this grid ever receives actually sold — getActiveListings
// is called with { sold: true } in the page — and apps/api/internal/
// listing's Sold filter only ever returns a real sale (a fixed listing with
// a buyer_id, or an auction whose outcome is "sold"/"bought_now"). An
// auction that timed out with zero bids is just as "ended" but was never a
// sale, so it's excluded entirely rather than showing up here mislabeled —
// there's no "Unsold"/"No Bids" branch to render anymore.
//
// awaitingShipment (real per-order state from getMyOrders, not just "has
// this been paid for") overrides the plain "Paid" pill with a clickable
// "Awaiting Shipment" one — the badge itself is the way to the shipping-
// label page, no separate button next to it.
function paymentBadge(listing: Listing, awaitingShipment: boolean): { label: string; paid: boolean } {
  if (awaitingShipment) return { label: "Awaiting Shipment", paid: true };
  return listing.paidAt ? { label: "Paid", paid: true } : { label: "Awaiting payment", paid: false };
}

function ListingGrid({
  listings,
  watchedIds,
  isLoggedIn,
  currentUserId,
  showOutcome,
  awaitingShipmentIds,
}: {
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  // Every listing this page ever shows is the viewer's own (getActiveListings
  // is always called with sellerId: local.userId in the page), so without
  // this every card here would render a Buy It Now/Make an Offer button on
  // the viewer's own listing — see ListingCard's own doc comment on the prop.
  currentUserId?: string;
  showOutcome?: boolean;
  awaitingShipmentIds?: Set<string>;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  // 4 is just a reasonable pre-measurement default (matches the lg
  // breakpoint) so the very first paint isn't stuck at the mobile 2-column
  // count on a wide screen — corrected by the ResizeObserver below before
  // the user would notice, same "unavoidable client-only guess" as any
  // other viewport-dependent layout with no server-known screen width.
  const [columns, setColumns] = useState(4);
  const [rowsShown, setRowsShown] = useState(INITIAL_ROWS);

  // Re-measure whenever the grid's own box changes width (window resize,
  // sidebar toggling, etc.) rather than reading window.innerWidth — this
  // reads the actual number of tracks Tailwind's responsive grid-cols-*
  // classes resolved to, so it never has to duplicate those breakpoints in
  // JS or drift out of sync with them.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    function measure() {
      const trackCount = getComputedStyle(el!).gridTemplateColumns.split(" ").filter(Boolean).length;
      setColumns(trackCount || 1);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Resets back to the first 5 rows whenever the listing set itself
  // changes (switching the Active/History tab, or the list shrinking after
  // a delete) — adjusted during render, React's own documented pattern for
  // "reset state when a prop changes," same shape ListingSection already
  // uses for its own prevItems.
  const [prevListings, setPrevListings] = useState(listings);
  if (listings !== prevListings) {
    setPrevListings(listings);
    setRowsShown(INITIAL_ROWS);
  }

  const visibleCount = columns * rowsShown;
  const visibleListings = listings.slice(0, visibleCount);
  const hasMore = listings.length > visibleCount;

  return (
    <>
    <div ref={gridRef} className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {visibleListings.map((listing) => (
        <div key={listing.id} className="flex flex-col gap-2">
          {showOutcome &&
            (() => {
              const awaitingShipment = Boolean(awaitingShipmentIds?.has(listing.id));
              const { label, paid } = paymentBadge(listing, awaitingShipment);
              const pillClass = `self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                paid ? "bg-brand-success/10 text-brand-success" : "bg-brand-gold/15 text-brand-gold"
              }`;
              return (
                <div className="flex items-center gap-1.5">
                  <span className="self-start rounded-full bg-brand-success px-2 py-0.5 text-[11px] font-semibold text-white">
                    Sold
                  </span>
                  {awaitingShipment ? (
                    <Link href={`/order/${listing.id}`} className={`${pillClass} underline decoration-dotted`}>
                      {label}
                    </Link>
                  ) : (
                    <span className={pillClass}>{label}</span>
                  )}
                </div>
              );
            })()}
          <ListingCard
            listing={listing}
            initialWatching={watchedIds.has(listing.id)}
            isLoggedIn={isLoggedIn}
            currentUserId={currentUserId}
            // Every listing on your own Selling page gets the same
            // treatment (product decision) — the seller/rating/tier row is
            // pure noise here, and favoriting your own listing isn't a real
            // action either, so the watch heart is swapped for the owner's
            // "⋮" Edit/Delete menu (ownerMenu). hideActions only actually
            // removes anything on the Active grid — the History grid
            // already renders "Sold"/a payment badge instead of an action
            // row regardless. Delete on a sold listing is still real, not a
            // dead menu item: the backend (listing.Cancel) rejects it with
            // a real "no longer active" error rather than the UI silently
            // pretending it would work.
            hideSellerFooter
            hideActions
            ownerMenu
            // The History grid (showOutcome) is every listing that already
            // sold — internal/listing.Update and .Cancel both reject a
            // non-active listing outright (ErrNotActive), so an Edit/Delete
            // menu here could only ever end in an error. No "⋮" at all,
            // matching the product decision that a sold listing is
            // permanently done, not just usually done.
            ownerMenuReadOnly={showOutcome}
          />
        </div>
      ))}
    </div>
    {hasMore && (
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => setRowsShown((r) => r + INITIAL_ROWS)}
          className="flex items-center gap-1.5 rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface"
        >
          <ChevronDown size={15} /> Load More
        </button>
      </div>
    )}
    </>
  );
}

// The Active/History toggle — same ModeButton pattern as Transactions'
// Sold/Purchased toggle (TransactionsList), just relabeled: "History" is
// what used to be an always-visible "Sold" section stacked underneath
// Active. Client-side only (no URL param), same reasoning as
// TransactionsList's own mode toggle — everything here operates over data
// the page already fetched in one round trip, nothing to usefully drive
// through a URL.
export default function SellingLists({
  mySelling,
  mySold,
  watchedIds,
  isLoggedIn,
  currentUserId,
  awaitingShipmentIds,
}: {
  mySelling: Listing[];
  mySold: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  currentUserId?: string;
  awaitingShipmentIds: Set<string>;
}) {
  const [mode, setMode] = useState<Mode>("active");

  if (mySelling.length === 0 && mySold.length === 0) {
    return (
      <p className="mt-6 text-sm text-gray-500">
        You don&apos;t have any active listings.{" "}
        <a href="/sell" className="font-medium text-brand-navy hover:underline">
          Create one
        </a>
        .
      </p>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex w-fit overflow-hidden rounded-lg border border-brand-border">
        <ModeButton
          icon={Package}
          label="Active"
          count={mySelling.length}
          active={mode === "active"}
          onClick={() => setMode("active")}
        />
        <ModeButton
          icon={History}
          label="History"
          count={mySold.length}
          active={mode === "history"}
          onClick={() => setMode("history")}
        />
      </div>

      {mode === "active" ? (
        mySelling.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Nothing currently listed.</p>
        ) : (
          <ListingGrid
            listings={mySelling}
            watchedIds={watchedIds}
            isLoggedIn={isLoggedIn}
            currentUserId={currentUserId}
          />
        )
      ) : mySold.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Nothing has sold yet.</p>
      ) : (
        <ListingGrid
          listings={mySold}
          watchedIds={watchedIds}
          isLoggedIn={isLoggedIn}
          currentUserId={currentUserId}
          showOutcome
          awaitingShipmentIds={awaitingShipmentIds}
        />
      )}
    </div>
  );
}
