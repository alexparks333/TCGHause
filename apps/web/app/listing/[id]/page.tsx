import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ShieldCheck, Truck, Check } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ListingGallery from "@/components/ListingGallery";
import SellerCard from "@/components/SellerCard";
import ItemSpecifics from "@/components/ItemSpecifics";
import ListingSection from "@/components/ListingSection";
import BidBox from "@/components/BidBox";
import { getListing, getActiveListings, getWatchStatus, getMyWatchedIds, getMyBids } from "@/lib/api";
import { formatPrice, formatTimeLeft, type MyBid } from "@/lib/types";
import { getCurrentSession } from "@/lib/session";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();

  const { session, user: currentUser } = await getCurrentSession();
  const isOwner = currentUser?.id === listing.sellerId;
  const hasEnded = listing.endsAt ? new Date(listing.endsAt).getTime() < Date.now() : false;

  // None of these four depend on each other — only on `session`/`listing`,
  // both already resolved — so they run in parallel instead of as four
  // separate sequential round trips.
  const [watchStatus, watchedIds, myBids, moreFromSellerRaw] = await Promise.all([
    session ? getWatchStatus(listing.id, session.access_token).catch(() => null) : Promise.resolve(null),
    session ? getMyWatchedIds(session.access_token).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    session ? getMyBids(session.access_token).catch(() => [] as MyBid[]) : Promise.resolve([] as MyBid[]),
    getActiveListings({ sellerId: listing.sellerId }),
  ]);
  const myBidsByListingId = new Map(myBids.map((b) => [b.listing.id, b]));
  const myBid = myBidsByListingId.get(listing.id);

  const moreFromSeller = moreFromSellerRaw.filter((l) => l.id !== listing.id);

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />

      <div className="w-full px-10 py-6 sm:px-12 lg:px-14">
        <nav className="mb-4 flex items-center gap-1.5 text-xs text-gray-500">
          <Link href="/" className="hover:text-brand-navy">
            Home
          </Link>
          <ChevronRight size={12} />
          <span>{listing.game}</span>
          <ChevronRight size={12} />
          <span className="truncate text-gray-700">{listing.title}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <ListingGallery
              listingId={listing.id}
              imageUrls={listing.imageUrls ?? []}
              watcherCount={watchStatus?.watcherCount ?? listing.watcherCount}
              initialWatching={watchStatus?.watching ?? false}
              isLoggedIn={Boolean(currentUser)}
              game={listing.game}
              title={listing.title}
            />

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
                {listing.game}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-gray-900">{listing.title}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {listing.set}
                {listing.cardNumber && ` · #${listing.cardNumber}`}
                {listing.rarity && ` · ${listing.rarity}`}
              </p>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-900">Item specifics</h2>
              <ItemSpecifics listing={listing} />
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-900">Description</h2>
              <p className="text-sm leading-relaxed text-gray-600">
                {listing.isGraded
                  ? `Professionally graded ${listing.gradingCompany} ${listing.grade}. Ships in a protective case with full tracking.`
                  : `Condition: ${listing.condition}. Ships in a rigid card sleeve with tracked delivery.`}
              </p>
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-xl border border-brand-border bg-white p-5">
              {listing.format === "auction" ? (
                <>
                  <p className="text-xs text-gray-500">
                    {hasEnded ? "Auction ended — final price" : "Current bid"}
                  </p>
                  <p className="text-3xl font-bold text-gray-900">
                    {formatPrice(listing.currentPriceCents ?? listing.startingBidCents ?? 0)}
                  </p>
                  <p className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-gray-500">{listing.bidCount ?? 0} bids</span>
                    <span className="font-semibold text-brand-urgent">
                      {listing.endsAt ? formatTimeLeft(listing.endsAt) : ""}
                    </span>
                  </p>

                  {hasEnded ? (
                    <p className="mt-4 text-sm text-gray-500">This auction has ended.</p>
                  ) : isOwner ? (
                    <p className="mt-4 text-sm text-gray-500">This is your listing.</p>
                  ) : currentUser ? (
                    <>
                      {myBid?.status === "winning" && (
                        <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-brand-success/10 px-3 py-2 text-sm font-semibold text-brand-success">
                          <Check size={16} /> You&apos;re the top bidder — winning up to{" "}
                          {formatPrice(myBid.myMaxBidCents)}
                        </p>
                      )}
                      <BidBox listing={listing} />
                    </>
                  ) : (
                    <Link
                      href="/login"
                      className="mt-4 block rounded-lg bg-brand-navy px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light"
                    >
                      Sign in to bid
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-500">Buy it now</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {formatPrice(listing.priceCents ?? 0)}
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled
                      title="Checkout isn't built yet"
                      className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white opacity-50"
                    >
                      Buy It Now (coming soon)
                    </button>
                  </div>
                </>
              )}

              <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
                <Truck size={14} />
                {listing.freeShipping
                  ? "Free shipping"
                  : `+${formatPrice(listing.shippingCostCents)} shipping`}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <ShieldCheck size={14} />
                Escrow protected, funds release after delivery confirmation
              </div>
            </div>

            <SellerCard username={listing.sellerUsername} />
          </aside>
        </div>
      </div>

      {moreFromSeller.length > 0 && (
        <div className="px-10 sm:px-12 lg:px-14">
          <ListingSection
            title={`More from ${listing.sellerUsername ?? "this seller"}`}
            items={moreFromSeller}
            watchedIds={watchedIds}
            isLoggedIn={Boolean(session)}
            myBidsByListingId={myBidsByListingId}
          />
        </div>
      )}

      <Footer />
    </div>
  );
}
