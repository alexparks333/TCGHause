import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ShieldCheck, Truck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ListingGallery from "@/components/ListingGallery";
import SellerCard from "@/components/SellerCard";
import ItemSpecifics from "@/components/ItemSpecifics";
import ListingSection from "@/components/ListingSection";
import AuctionPriceBox from "@/components/AuctionPriceBox";
import BuyNowButton from "@/components/BuyNowButton";
import SoldBanner from "@/components/SoldBanner";
import { getListing, getActiveListings, getWatchStatus, getMyWatchedIds, getMyBids } from "@/lib/api";
import { formatPrice, type MyBid } from "@/lib/types";
import { getLocalSession } from "@/lib/session";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // getListing and getLocalSession don't depend on each other, so they run
  // together instead of stacking — this page never displays verified
  // identity (email/avatar/name), only compares ids (isOwner) and reads
  // the access_token, so the fast local cookie read is enough here; no
  // need for getCurrentSession()'s slower getUser() network verification.
  const [listing, local] = await Promise.all([getListing(id), getLocalSession()]);
  if (!listing) notFound();

  const isOwner = local?.userId === listing.sellerId;

  // None of these four depend on each other — only on `local`/`listing`,
  // both already resolved — so they run in parallel instead of as four
  // separate sequential round trips.
  const [watchStatus, watchedIds, myBids, moreFromSellerRaw] = await Promise.all([
    local ? getWatchStatus(listing.id, local.accessToken).catch(() => null) : Promise.resolve(null),
    local ? getMyWatchedIds(local.accessToken).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    local ? getMyBids(local.accessToken).catch(() => [] as MyBid[]) : Promise.resolve([] as MyBid[]),
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
              isLoggedIn={Boolean(local)}
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
                <AuctionPriceBox
                  listing={listing}
                  isOwner={isOwner}
                  isLoggedIn={Boolean(local)}
                  currentUserId={local?.userId}
                  myBid={myBid}
                />
              ) : (
                <>
                  <p className="text-xs text-gray-500">Buy it now</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {formatPrice(listing.priceCents ?? 0)}
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    {listing.buyerId ? (
                      <SoldBanner
                        label={
                          local?.userId === listing.buyerId
                            ? listing.paidAt
                              ? "You bought this — paid."
                              : "You bought this."
                            : "This listing has already sold."
                        }
                      />
                    ) : isOwner ? (
                      <p className="text-sm text-gray-500">This is your listing.</p>
                    ) : local ? (
                      <BuyNowButton listingId={listing.id} priceCents={listing.priceCents ?? 0} />
                    ) : (
                      <Link
                        href="/login"
                        className="rounded-lg bg-brand-navy px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light"
                      >
                        Sign in to buy
                      </Link>
                    )}
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
                Payment protected — released to the seller after your delivery window
              </div>
            </div>

            <SellerCard
              username={listing.sellerUsername}
              tier={listing.sellerTier}
              sellerId={listing.sellerId}
              listingId={listing.id}
              canMessage={Boolean(local) && !isOwner}
            />
          </aside>
        </div>
      </div>

      {moreFromSeller.length > 0 && (
        <div className="px-10 sm:px-12 lg:px-14">
          <ListingSection
            title={`More from ${listing.sellerUsername ?? "this seller"}`}
            items={moreFromSeller}
            watchedIds={watchedIds}
            isLoggedIn={Boolean(local)}
            myBidsByListingId={myBidsByListingId}
          />
        </div>
      )}

      <Footer />
    </div>
  );
}
