import { getActiveListings, getMyWatchedIds } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import ListingCard from "@/components/ListingCard";
import type { Listing } from "@/lib/types";

// A fixed-format listing has no Outcome at all (that field only exists on
// the auctions table) — BuyerID set is its equivalent of "sold". "No Bids"
// only ever applies to an auction that timed out with nobody watching.
function outcomeBadge(listing: Listing): { label: string; sold: boolean } {
  if (listing.format === "fixed") {
    return listing.buyerId ? { label: "Sold", sold: true } : { label: "Unsold", sold: false };
  }
  if (listing.outcome === "no_bids") return { label: "No Bids", sold: false };
  return { label: "Sold", sold: true };
}

function ListingGrid({
  listings,
  watchedIds,
  isLoggedIn,
  showOutcome,
}: {
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  showOutcome?: boolean;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {listings.map((listing) => (
        <div key={listing.id} className="flex flex-col gap-2">
          {showOutcome &&
            (() => {
              const { label, sold } = outcomeBadge(listing);
              return (
                <div className="flex items-center gap-1.5">
                  <span
                    className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${
                      sold ? "bg-brand-success" : "bg-brand-urgent"
                    }`}
                  >
                    {label}
                  </span>
                  {sold && (
                    <span
                      className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        listing.paidAt
                          ? "bg-brand-success/10 text-brand-success"
                          : "bg-brand-gold/15 text-brand-gold"
                      }`}
                    >
                      {listing.paidAt ? "Paid" : "Awaiting payment"}
                    </span>
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

  const [mySelling, myFinished, watchedIds] = await Promise.all([
    local ? getActiveListings({ sellerId: local.userId }) : Promise.resolve([]),
    local ? getActiveListings({ sellerId: local.userId, finished: true }) : Promise.resolve([]),
    local
      ? getMyWatchedIds(local.accessToken).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);

  const isLoggedIn = Boolean(local);

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Selling</h1>
      <p className="mt-1 text-sm text-gray-500">Your active listings.</p>

      {mySelling.length === 0 && myFinished.length === 0 ? (
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
            <h2 className="text-sm font-semibold text-gray-900">Finished</h2>
            {myFinished.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Nothing has ended yet.</p>
            ) : (
              <ListingGrid
                listings={myFinished}
                watchedIds={watchedIds}
                isLoggedIn={isLoggedIn}
                showOutcome
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
