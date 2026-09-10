import { getMyBids, getMySentOffers, getMyReceivedOffers, type Offer } from "@/lib/api";
import type { MyBid } from "@/lib/types";
import { getLocalSession } from "@/lib/session";
import BidsOffersApp from "@/components/BidsOffersApp";

export default async function BidsOffersPage({
  searchParams,
}: {
  // ?offer=<id> — set by the notification bell's offer_received/
  // offer_accepted/offer_declined link (NotificationBell's
  // notificationHref) so the Offers tab can visually call out the one
  // this page was linked from.
  searchParams: Promise<{ offer?: string }>;
}) {
  // app/account/layout.tsx already gates this route on a real verified
  // session, so a local cookie read for the access_token is all this page
  // needs — see lib/session.ts's getLocalSession doc comment.
  const [local, { offer: highlightOfferId }] = await Promise.all([getLocalSession(), searchParams]);

  const [bids, sentOffers, receivedOffers] = await Promise.all([
    local ? getMyBids(local.accessToken) : Promise.resolve([] as MyBid[]),
    local ? getMySentOffers(local.accessToken) : Promise.resolve([] as Offer[]),
    local ? getMyReceivedOffers(local.accessToken) : Promise.resolve([] as Offer[]),
  ]);

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Bids/Offers</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every auction you&apos;re bidding in, closest to closing first, plus every offer you&apos;ve
        sent or received.
      </p>
      <BidsOffersApp
        bids={bids}
        sentOffers={sentOffers}
        receivedOffers={receivedOffers}
        highlightOfferId={highlightOfferId}
      />
    </div>
  );
}
