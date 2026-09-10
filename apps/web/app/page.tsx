import Link from "next/link";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import ListingSection from "@/components/ListingSection";
import FilterSidebar from "@/components/FilterSidebar";
import Footer from "@/components/Footer";
import { getActiveListings, getMe, getMyWatchedIds, getMyBids } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import type { MyBid } from "@/lib/types";
import { paramStr, paramNum, paramBool, type SearchParams } from "@/lib/search-params";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const game = paramStr(params, "game");
  const q = paramStr(params, "q");
  const sold = paramBool(params, "sold");
  const fixedOnly = paramBool(params, "fixedOnly");
  const conditionMin = paramStr(params, "conditionMin");
  const priceMinCents = paramNum(params, "priceMin");
  const priceMaxCents = paramNum(params, "priceMax");
  const timeLeftMinHours = paramNum(params, "timeLeftMin");
  const timeLeftMaxHours = paramNum(params, "timeLeftMax");

  const isFiltered =
    Boolean(game) ||
    Boolean(q) ||
    sold ||
    fixedOnly ||
    Boolean(conditionMin) ||
    priceMinCents !== undefined ||
    priceMaxCents !== undefined ||
    timeLeftMinHours !== undefined ||
    timeLeftMaxHours !== undefined;

  // Only the search box (not the category bubbles/other filters) switches
  // into the eBay-style row layout — a plain category browse still gets
  // the normal card grid, per product decision.
  const isSearch = Boolean(q);

  // Independent fetches — listings don't depend on the session, and
  // watchlist/bids don't depend on each other, so all four run in
  // parallel instead of stacking up as separate round trips.
  // getLocalSession() (a local cookie read, not a network round trip) is
  // enough here — this page never displays verified identity, only the
  // access_token and a plain isLoggedIn check.
  const [listings, local] = await Promise.all([
    getActiveListings({
      game,
      search: q,
      sold,
      fixedOnly,
      conditionMin,
      priceMinCents,
      priceMaxCents,
      timeLeftMinHours,
      timeLeftMaxHours,
    }),
    getLocalSession(),
  ]);
  // getMe is wrapped in cache() (lib/api.ts) and Header fetches it too with
  // the same access token in the same request, so this doesn't cost a
  // second round trip to the Go API — it's what lets Hero show the
  // viewer's real tier-based fee instead of a flat advertised number.
  const [watchedIds, myBids, me] = await Promise.all([
    local ? getMyWatchedIds(local.accessToken).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    local ? getMyBids(local.accessToken).catch(() => [] as MyBid[]) : Promise.resolve([] as MyBid[]),
    local ? getMe(local.accessToken).catch(() => null) : Promise.resolve(null),
  ]);
  const myBidsByListingId = new Map(myBids.map((b) => [b.listing.id, b]));

  const auctions = listings
    .filter((l) => l.format === "auction")
    .sort(
      (a, b) => new Date(a.endsAt ?? 0).getTime() - new Date(b.endsAt ?? 0).getTime(),
    );

  const fixedPrice = listings.filter((l) => l.format === "fixed");

  // Hero's featured stack — real auctions ranked by real watcher count,
  // highest first. Only meaningful on the true unfiltered landing view
  // (where `auctions` is already the site-wide active set, not a filtered
  // slice), which is also the only view Hero renders in at all.
  const featuredAuctions = [...auctions]
    .sort((a, b) => b.watcherCount - a.watcherCount)
    .slice(0, 5);

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header searchParams={params} />
      {/* Hero is the true-homepage / "All Categories" landing area — hidden
          the moment a category or search filter narrows the view, per
          product decision, so filtered browsing reads as a results page,
          not a landing page with results tacked on underneath it. */}
      {!isFiltered && <Hero featuredAuctions={featuredAuctions} tier={me?.tier ?? null} />}
      <div className="flex-1 py-2 pl-3 pr-10 sm:pl-4 sm:pr-12 lg:pl-5 lg:pr-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
          <FilterSidebar searchParams={params} />
          <div className="min-w-0 flex-1">
            {listings.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm text-gray-500">
                  {isFiltered ? (
                    <>
                      No listings match these filters.{" "}
                      <Link href="/" className="font-medium text-brand-navy hover:underline">
                        Clear filters
                      </Link>
                    </>
                  ) : (
                    <>
                      No listings yet — be the first to{" "}
                      <a href="/sell" className="font-medium text-brand-navy hover:underline">
                        create one
                      </a>
                      .
                    </>
                  )}
                </p>
              </div>
            ) : isSearch ? (
              <ListingSection
                title={`${listings.length} result${listings.length === 1 ? "" : "s"} for "${q}"`}
                items={listings}
                watchedIds={watchedIds}
                isLoggedIn={Boolean(local)}
                currentUserId={local?.userId}
                myBidsByListingId={myBidsByListingId}
                layout="row"
              />
            ) : (
              <>
                {auctions.length > 0 && (
                  <ListingSection
                    id="ending-soon"
                    title="Ending soon"
                    subtitle="Live auctions"
                    items={auctions}
                    watchedIds={watchedIds}
                    isLoggedIn={Boolean(local)}
                    currentUserId={local?.userId}
                    myBidsByListingId={myBidsByListingId}
                  />
                )}
                {fixedPrice.length > 0 && (
                  <ListingSection
                    title="Buy it now"
                    subtitle="Fixed-price listings, ready to ship"
                    items={fixedPrice}
                    watchedIds={watchedIds}
                    isLoggedIn={Boolean(local)}
                    currentUserId={local?.userId}
                    myBidsByListingId={myBidsByListingId}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
