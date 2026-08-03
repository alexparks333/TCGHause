import Link from "next/link";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import ListingSection from "@/components/ListingSection";
import FilterSidebar from "@/components/FilterSidebar";
import Footer from "@/components/Footer";
import { getActiveListings, getMyWatchedIds, getMyBids } from "@/lib/api";
import { getCurrentSession } from "@/lib/session";
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
  const finished = paramBool(params, "finished");
  const fixedOnly = paramBool(params, "fixedOnly");
  const conditionMin = paramStr(params, "conditionMin");
  const priceMinCents = paramNum(params, "priceMin");
  const priceMaxCents = paramNum(params, "priceMax");
  const timeLeftMinHours = paramNum(params, "timeLeftMin");
  const timeLeftMaxHours = paramNum(params, "timeLeftMax");

  const isFiltered =
    Boolean(game) ||
    Boolean(q) ||
    finished ||
    fixedOnly ||
    Boolean(conditionMin) ||
    priceMinCents !== undefined ||
    priceMaxCents !== undefined ||
    timeLeftMinHours !== undefined ||
    timeLeftMaxHours !== undefined;

  // Independent fetches — listings don't depend on the session, and
  // watchlist/bids don't depend on each other, so all four run in
  // parallel instead of stacking up as separate round trips.
  const [listings, { session }] = await Promise.all([
    getActiveListings({
      game,
      search: q,
      finished,
      fixedOnly,
      conditionMin,
      priceMinCents,
      priceMaxCents,
      timeLeftMinHours,
      timeLeftMaxHours,
    }),
    getCurrentSession(),
  ]);
  const [watchedIds, myBids] = await Promise.all([
    session ? getMyWatchedIds(session.access_token).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    session ? getMyBids(session.access_token).catch(() => [] as MyBid[]) : Promise.resolve([] as MyBid[]),
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
      {!isFiltered && <Hero featuredAuctions={featuredAuctions} />}
      <div className="flex-1 py-6 pl-3 pr-10 sm:pl-4 sm:pr-12 lg:pl-5 lg:pr-14">
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
            ) : (
              <>
                {auctions.length > 0 && (
                  <ListingSection
                    id="ending-soon"
                    title="Ending soon"
                    subtitle="Live auctions"
                    items={auctions}
                    watchedIds={watchedIds}
                    isLoggedIn={Boolean(session)}
                    myBidsByListingId={myBidsByListingId}
                  />
                )}
                {fixedPrice.length > 0 && (
                  <ListingSection
                    title="Buy it now"
                    subtitle="Fixed-price listings, ready to ship"
                    items={fixedPrice}
                    watchedIds={watchedIds}
                    isLoggedIn={Boolean(session)}
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
