import { getMyBids, getMyWatchedIds } from "@/lib/api";
import { formatPrice } from "@/lib/types";
import type { MyBid } from "@/lib/types";
import { getCurrentSession } from "@/lib/session";
import ListingCard from "@/components/ListingCard";

function hasEnded(bid: MyBid): boolean {
  return Boolean(bid.listing.endsAt) && new Date(bid.listing.endsAt!).getTime() <= Date.now();
}

function BidGrid({
  bids,
  watchedIds,
  isLoggedIn,
  badge,
}: {
  bids: MyBid[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  badge: (bid: MyBid) => { label: string; won: boolean };
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {bids.map((bid) => {
        const { listing, myMaxBidCents } = bid;
        const { label, won } = badge(bid);
        return (
          <div key={listing.id} className="flex flex-col gap-2">
            <span
              className={`self-start rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${
                won ? "bg-brand-success" : "bg-brand-urgent"
              }`}
            >
              {label}
            </span>
            <ListingCard
              listing={listing}
              initialWatching={watchedIds.has(listing.id)}
              isLoggedIn={isLoggedIn}
            />
            <p className="text-xs text-gray-500">
              Your max bid: {formatPrice(myMaxBidCents)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default async function BuyingPage() {
  const { session } = await getCurrentSession();

  const [myBids, watchedIds] = await Promise.all([
    session ? getMyBids(session.access_token) : Promise.resolve([]),
    session ? getMyWatchedIds(session.access_token).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);

  const isLoggedIn = Boolean(session);
  const currentBids = myBids.filter((bid) => !hasEnded(bid));
  const finishedBids = myBids.filter((bid) => hasEnded(bid));
  const wonBids = finishedBids.filter((bid) => bid.status === "winning");

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Buying</h1>
      <p className="mt-1 text-sm text-gray-500">Auctions you're currently bidding on.</p>

      {myBids.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">You're not bidding on anything right now.</p>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-gray-900">Current Bids</h2>
            {currentBids.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No active bids right now.</p>
            ) : (
              <BidGrid
                bids={currentBids}
                watchedIds={watchedIds}
                isLoggedIn={isLoggedIn}
                badge={(bid) =>
                  bid.status === "winning"
                    ? { label: "Winning", won: true }
                    : { label: "Outbid", won: false }
                }
              />
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-gray-900">Finished</h2>
            {finishedBids.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No auctions have ended yet.</p>
            ) : (
              <BidGrid
                bids={finishedBids}
                watchedIds={watchedIds}
                isLoggedIn={isLoggedIn}
                badge={(bid) =>
                  bid.status === "winning"
                    ? { label: "Won", won: true }
                    : { label: "Lost", won: false }
                }
              />
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold text-gray-900">Won</h2>
            {wonBids.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">You haven't won any auctions yet.</p>
            ) : (
              <BidGrid
                bids={wonBids}
                watchedIds={watchedIds}
                isLoggedIn={isLoggedIn}
                badge={() => ({ label: "Won", won: true })}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
