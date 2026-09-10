import { getActiveListings, getMyOrders, getMyWatchedIds } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import SellingLists from "@/components/SellingLists";

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

      <SellingLists
        mySelling={mySelling}
        mySold={mySold}
        watchedIds={watchedIds}
        isLoggedIn={isLoggedIn}
        currentUserId={local?.userId}
        awaitingShipmentIds={awaitingShipmentIds}
      />
    </div>
  );
}
