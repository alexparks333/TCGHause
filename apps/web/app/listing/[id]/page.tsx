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
import MakeOfferButton from "@/components/MakeOfferButton";
import OffersPanel from "@/components/OffersPanel";
import SoldBanner from "@/components/SoldBanner";
import OwnerListingBanner from "@/components/OwnerListingBanner";
import {
  ApiError,
  getListing,
  getActiveListings,
  getWatchStatus,
  getMyWatchedIds,
  getMyBids,
  getOrderForListing,
  getOffersForListing,
  labelFromOrder,
  isShippingLabelVisible,
  type Order,
  type Offer,
} from "@/lib/api";
import { formatPrice, shippingCostLabel, shippingMethodLabel, type MyBid } from "@/lib/types";
import { getLocalSession } from "@/lib/session";
import ShippingLabelControl from "@/components/ShippingLabelControl";

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // ?offer=<id> — set by the notification bell's offer_received link
  // (NotificationBell's notificationHref) so OffersPanel below can
  // visually call out the one offer this page was linked from.
  searchParams: Promise<{ offer?: string }>;
}) {
  const { id } = await params;
  const { offer: highlightOfferId } = await searchParams;

  // getListing and getLocalSession don't depend on each other, so they run
  // together instead of stacking — this page never displays verified
  // identity (email/avatar/name), only compares ids (isOwner) and reads
  // the access_token, so the fast local cookie read is enough here; no
  // need for getCurrentSession()'s slower getUser() network verification.
  const [listing, local] = await Promise.all([getListing(id), getLocalSession()]);
  if (!listing) notFound();

  const isOwner = local?.userId === listing.sellerId;
  // Covers both formats: a fixed-price listing sold the moment it has a
  // buyerId; an auction sold once it closed with a real winner (either
  // bought outright or won via bidding) — an auction that simply timed out
  // with no bids ('no_bids') never counts, same distinction §6.13 already
  // draws for the Selling page's Sold section.
  const hasSold =
    (listing.format === "fixed" && Boolean(listing.buyerId)) ||
    (listing.format === "auction" && (listing.outcome === "sold" || listing.outcome === "bought_now"));

  // None of these six depend on each other — only on `local`/`listing`,
  // both already resolved — so they run in parallel instead of as six
  // separate sequential round trips. The order fetch only fires for the
  // seller viewing their own sold listing — internal/order.GetForListing
  // would 404 for anyone else anyway (order.HandleGetForListing checks
  // participancy), so there's no point calling it otherwise. The offers
  // fetch only fires for the seller viewing their own listing with offers
  // actually enabled — internal/offer.ListForListing would reject anyone
  // else's call anyway (only that listing's own seller may list them).
  const [watchStatus, watchedIds, myBids, moreFromSellerRaw, order, offers] = await Promise.all([
    local ? getWatchStatus(listing.id, local.accessToken).catch(() => null) : Promise.resolve(null),
    local ? getMyWatchedIds(local.accessToken).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    local ? getMyBids(local.accessToken).catch(() => [] as MyBid[]) : Promise.resolve([] as MyBid[]),
    getActiveListings({ sellerId: listing.sellerId }),
    isOwner && hasSold && local
      ? getOrderForListing(listing.id, local.accessToken).catch((err) => {
          // 404 just means this sale predates internal/order or went
          // through the no-Stripe mock-payment path — nothing to show,
          // not a real error. Anything else should still surface.
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        })
      : Promise.resolve(null as Order | null),
    isOwner && listing.allowOffers && local
      ? getOffersForListing(listing.id, local.accessToken).catch(() => [] as Offer[])
      : Promise.resolve([] as Offer[]),
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

        {/* Left column is sized to the gallery's own max-width (48rem,
            ListingGallery), not a fixed 2/3 page fraction — otherwise the
            gallery (capped at 48rem regardless) leaves dead space before
            the grid gap even starts on any screen wider than that. The
            price/bid box gets all the leftover width instead, which is
            what actually closes the gap without changing the photo's size. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,48rem)_1fr]">
          <div className="flex flex-col gap-3">
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
              <p className="text-sm font-medium uppercase tracking-wide text-brand-gold">
                {listing.game}
              </p>
              <h1 className="mt-1 text-3xl font-bold text-gray-900">{listing.title}</h1>
              <p className="mt-1 text-base text-gray-500">
                {listing.set}
                {listing.cardNumber && ` · #${listing.cardNumber}`}
                {listing.rarity && ` · ${listing.rarity}`}
              </p>
            </div>

            <div>
              <h2 className="mb-2 text-base font-semibold text-gray-900">Item specifics</h2>
              <ItemSpecifics listing={listing} />
            </div>

            <div>
              <h2 className="mb-2 text-base font-semibold text-gray-900">Description</h2>
              <p className="text-base leading-relaxed text-gray-600">
                {listing.isGraded
                  ? `Professionally graded ${listing.gradingCompany} ${listing.grade}. Ships in a protective case with full tracking.`
                  : `Condition: ${listing.condition}. Ships in a rigid card sleeve with tracked delivery.`}
              </p>
            </div>
          </div>

          {/* The gallery column is capped at 48rem; this column is
              everything left over in the row (1fr), and now fills it
              fully instead of sitting pinned to a narrow max-w-sm — the
              price/bid box grows to use the real remaining width instead
              of leaving a gap before the page's own edge padding. */}
          <aside className="flex w-full flex-col gap-4">
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
                  <p className="text-xs text-gray-500">{listing.buyerId ? "Sold for" : "Buy it now"}</p>
                  {/* Same red-when-sold convention ListingCard already
                      applies to its own fixed-price figure
                      (listing.buyerId ? text-brand-urgent : text-gray-900)
                      — soldPriceCents wins over priceCents when set, since
                      an accepted-offer sale can close at a different amount
                      than the original asking price (order/[id]/page.tsx
                      already prefers it the same way). */}
                  <p className={`text-3xl font-bold ${listing.buyerId ? "text-brand-urgent" : "text-gray-900"}`}>
                    {formatPrice((listing.buyerId ? listing.soldPriceCents : undefined) ?? listing.priceCents ?? 0)}
                  </p>
                  <div className="mt-4 flex flex-col gap-2">
                    {listing.buyerId && local?.userId === listing.buyerId && !listing.paidAt ? (
                      // Reserved for this buyer via an accepted offer — same
                      // "won, pay later" shape as AuctionPriceBox's own
                      // youWonAwaitingPayment box, just for a fixed listing
                      // (BuyNowFixed always paid+sold atomically, so this
                      // state was never reachable before offers existed).
                      <div className="rounded-lg bg-brand-gold/10 p-3">
                        <p className="text-sm font-semibold text-brand-gold">Your offer was accepted!</p>
                        <p className="mt-1 text-sm text-gray-600">
                          Pay {formatPrice(listing.soldPriceCents ?? listing.priceCents ?? 0)} to complete your
                          purchase.
                        </p>
                        <Link
                          href={`/checkout/${listing.id}`}
                          className="mt-3 block rounded-lg bg-brand-gold px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light"
                        >
                          Pay now
                        </Link>
                      </div>
                    ) : listing.buyerId ? (
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
                      <OwnerListingBanner />
                    ) : local ? (
                      <>
                        <BuyNowButton listingId={listing.id} priceCents={listing.priceCents ?? 0} />
                        {listing.allowOffers && (
                          <MakeOfferButton
                            listingId={listing.id}
                            binPriceCents={listing.priceCents ?? 0}
                            minOfferCents={listing.minOfferCents}
                          />
                        )}
                      </>
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

              {/* AuctionPriceBox now renders this block itself (right after
                  the price header, above the bidding box — Buy It Now moved
                  below both, see that component's own comment) — only the
                  fixed-price branch above still needs it rendered here. */}
              {listing.format !== "auction" && (
                <>
                  <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
                    <Truck size={18} />
                    <span>
                      <span className="font-medium text-gray-700">{shippingCostLabel(listing)}</span>
                      {" : "}
                      {shippingMethodLabel(listing)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                    <ShieldCheck size={14} />
                    Payment protected — released to the seller after your delivery window
                  </div>
                </>
              )}
            </div>

            {isOwner && order && isShippingLabelVisible(order.state, Boolean(order.labelUrl)) && (
              <div className="rounded-xl border border-brand-border bg-white p-5">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">Shipping</h2>
                <ShippingLabelControl
                  listingId={listing.id}
                  initialLabel={labelFromOrder(order)}
                  shippingPreset={order.shippingPreset}
                  estimatedShippingCents={listing.estimatedShippingCents}
                  signatureRequired={order.signatureRequired}
                  state={order.state}
                />
              </div>
            )}

            {isOwner && listing.allowOffers && (
              <OffersPanel initialOffers={offers} highlightOfferId={highlightOfferId} />
            )}

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
            currentUserId={local?.userId}
            myBidsByListingId={myBidsByListingId}
          />
        </div>
      )}

      <Footer />
    </div>
  );
}
