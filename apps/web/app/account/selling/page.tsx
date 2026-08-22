import Link from "next/link";
import { getActiveListings, getMyOrders, getMyWatchedIds } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import ListingCard from "@/components/ListingCard";
import type { Listing } from "@/lib/types";

// Every listing this grid ever receives actually sold — getActiveListings
// is called with { sold: true } below, and apps/api/internal/listing's Sold
// filter only ever returns a real sale (a fixed listing with a buyer_id, or
// an auction whose outcome is "sold"/"bought_now"). An auction that timed
// out with zero bids is just as "ended" but was never a sale, so it's
// excluded entirely rather than showing up here mislabeled — there's no
// "Unsold"/"No Bids" branch to render anymore.
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
  showOutcome,
  awaitingShipmentIds,
}: {
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  showOutcome?: boolean;
  awaitingShipmentIds?: Set<string>;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {listings.map((listing) => (
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
          />
        </div>
      ))}
    </div>
  );
}

export default async function SellingPage() {
  // Local cookie read, not a verified getCurrentSession()/getUser() call —
  // app/account/layout.tsx already gates this whole route on a real
  // verified session, and userId here is only ever used as a "which
  // listings are mine" query filter, never an authorization decision. See
  // lib/session.ts's LocalSession doc comment for why that's safe.
  const local = await getLocalSession();

  const [mySelling, mySold, watchedIds, myOrders] = await Promise.all([
    local ? getActiveListings({ sellerId: local.userId }) : Promise.resolve([]),
    local ? getActiveListings({ sellerId: local.userId, sold: true }) : Promise.resolve([]),
    local
      ? getMyWatchedIds(local.accessToken).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    local ? getMyOrders(local.accessToken).catch(() => []) : Promise.resolve([]),
  ]);

  const isLoggedIn = Boolean(local);
  const awaitingShipmentIds = new Set(
    myOrders.filter((o) => o.viewerIsSeller && o.state === "awaiting_ship").map((o) => o.listingId),
  );

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Selling</h1>
      <p className="mt-1 text-sm text-gray-500">Your active listings.</p>

      {mySelling.length === 0 && mySold.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">
          You don't have any active listings.{" "}
          <a href="/sell" className="font-medium text-brand-navy hover:underline">
            Create one
          </a>
          .
        </p>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-gray-900">Active</h2>
            {mySelling.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Nothing currently listed.</p>
            ) : (
              <ListingGrid listings={mySelling} watchedIds={watchedIds} isLoggedIn={isLoggedIn} />
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-gray-900">Sold</h2>
            {mySold.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Nothing has sold yet.</p>
            ) : (
              <ListingGrid
                listings={mySold}
                watchedIds={watchedIds}
                isLoggedIn={isLoggedIn}
                showOutcome
                awaitingShipmentIds={awaitingShipmentIds}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
