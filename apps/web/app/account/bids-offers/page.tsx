import { getMyBids } from "@/lib/api";
import { hasBidEnded } from "@/lib/types";
import { getLocalSession } from "@/lib/session";
import BidsTable from "@/components/BidsTable";

export default async function BidsOffersPage() {
  // app/account/layout.tsx already gates this route on a real verified
  // session, so a local cookie read for the access_token is all this page
  // needs — see lib/session.ts's getLocalSession doc comment.
  const local = await getLocalSession();

  const myBids = local ? await getMyBids(local.accessToken) : [];

  const activeBids = myBids.filter((bid) => !hasBidEnded(bid));
  // Most recently ended first — the newest result is the interesting one
  // in a history list. Sorts on closedAt (when the auction actually
  // closed), falling back to endsAt only for the rare row missing it —
  // closedAt is what's accurate for an auction bought outright via Buy It
  // Now before its originally-scheduled end time ever arrived; endsAt
  // alone would sort those into the wrong place entirely.
  const endedBids = myBids
    .filter((bid) => hasBidEnded(bid))
    .sort((a, b) => {
      const aTime = new Date(a.listing.closedAt ?? a.listing.endsAt!).getTime();
      const bTime = new Date(b.listing.closedAt ?? b.listing.endsAt!).getTime();
      return bTime - aTime;
    });

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Bids/Offers</h1>
      <p className="mt-1 text-sm text-gray-500">
        Your active bid amounts across every auction you're in.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-900">Active</h2>
        <BidsTable
          items={activeBids}
          variant="active"
          emptyMessage="You don't have any active bids or offers."
        />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-gray-900">Ended</h2>
        <BidsTable
          items={endedBids}
          variant="ended"
          emptyMessage="No auctions have ended yet."
          scrollable
        />
      </section>
    </div>
  );
}
