import { getActiveListings, getMyWatchedIds } from "@/lib/api";
import { getCurrentSession } from "@/lib/session";
import ListingCard from "@/components/ListingCard";
import type { Listing } from "@/lib/types";

function outcomeBadge(listing: Listing): { label: string; sold: boolean } {
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
                <span
                  className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${
                    sold ? "bg-brand-success" : "bg-brand-urgent"
                  }`}
                >
                  {label}
                </span>
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
  const { session, user } = await getCurrentSession();

  const [mySelling, myFinished, watchedIds] = await Promise.all([
    user ? getActiveListings({ sellerId: user.id }) : Promise.resolve([]),
    user ? getActiveListings({ sellerId: user.id, finished: true }) : Promise.resolve([]),
    session ? getMyWatchedIds(session.access_token).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);

  const isLoggedIn = Boolean(session);
  // getActiveListings({ finished: true }) returns every ended auction of
  // the seller's, not just auction-format ones with a real end — fixed-price
  // listings never appear here since they have no ends_at to have passed.
  const finishedAuctions = myFinished.filter((l) => l.format === "auction");

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Selling</h1>
      <p className="mt-1 text-sm text-gray-500">Your active listings.</p>

      {mySelling.length === 0 && finishedAuctions.length === 0 ? (
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
            {finishedAuctions.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No auctions have ended yet.</p>
            ) : (
              <ListingGrid
                listings={finishedAuctions}
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
