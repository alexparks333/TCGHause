import { getMyWatchedIds, getListing } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import ListingCard from "@/components/ListingCard";
import { hasListingEnded, type Listing } from "@/lib/types";

export default async function WatchlistPage() {
  // Local cookie read, not a verified getCurrentSession()/getUser() call —
  // app/account/layout.tsx already gates this whole route on a real
  // verified session.
  const local = await getLocalSession();

  const watchedIds = local
    ? await getMyWatchedIds(local.accessToken).catch(() => new Set<string>())
    : new Set<string>();

  // Watching something that later sells or ends doesn't keep it here — the
  // only place to still find it is a Sold-filtered search, same as
  // anywhere else on the site (never Recently Viewed/Live Auctions/an
  // unfiltered browse either).
  const listings = (
    await Promise.all(Array.from(watchedIds).map((id) => getListing(id)))
  ).filter((l): l is Listing => l !== null && !hasListingEnded(l));

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Watchlist</h1>
      <p className="mt-1 text-sm text-gray-500">Listings you're keeping an eye on.</p>

      {listings.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">
          You're not watching anything yet. Tap the heart on a listing to save it here.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {listings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              initialWatching
              isLoggedIn={Boolean(local)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
