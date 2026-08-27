import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Truck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ListingGallery from "@/components/ListingGallery";
import ItemSpecifics from "@/components/ItemSpecifics";
import SellerCard from "@/components/SellerCard";
import MockCheckout from "@/components/MockCheckout";
import { getListing, getWatchStatus } from "@/lib/api";
import { shippingDisplayText } from "@/lib/types";
import { getLocalSession } from "@/lib/session";

// The mock "Purchasing" page a Buy It Now click lands on — deliberately a
// separate step from the click itself. Landing here (or even sitting here
// for a while) doesn't reserve or touch the listing at all; the listing
// only actually gets bought, and taken down, the instant the "Pay" button's
// real POST /listings/{id}/buy-now call commits (MockCheckout). That's what
// makes two people racing to buy the same card safe: both can be looking
// at this exact page for the same listing at once, and only whichever one's
// payment click's request reaches the database first wins — the same
// race-safe compare-and-swap that already backs bid placement and auction
// close (CLAUDE.md §5.3), just triggered by "Pay" instead of "Buy It Now".
//
// Same two-column layout as the listing detail page — the full listing
// (gallery, specifics, seller) on the left, so a buyer can still see
// exactly what they're paying for while they pay, not just a tiny
// thumbnail off to the side.
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [listing, local] = await Promise.all([getListing(id), getLocalSession()]);
  if (!listing) notFound();
  if (!local) redirect("/login");

  const isOwner = local.userId === listing.sellerId;

  // Won via regular bidding (not Buy It Now) and not yet paid — ownership
  // already resolved when the auction closed, so this is purely a payment
  // step (internal/auction.PayForWonAuction), at the final winning bid
  // amount, not a Buy It Now purchase.
  const isWonAwaitingPayment =
    listing.format === "auction" &&
    listing.outcome === "sold" &&
    listing.highBidderId === local.userId &&
    !listing.paidAt;

  const priceCents = isWonAwaitingPayment
    ? listing.currentPriceCents
    : listing.format === "fixed"
      ? listing.priceCents ?? 0
      : listing.buyItNowPriceCents;

  // Nothing to buy/pay for here — either it's not eligible for Buy It Now
  // at all (a plain auction with no buyItNowPriceCents), someone already
  // bought it, or (won-but-unpaid aside) the auction has simply closed.
  // This is a courtesy redirect for stale links, not the real guard —
  // MockCheckout's own payment call re-checks everything atomically
  // server-side regardless of what this page saw at load time.
  const alreadySold = isWonAwaitingPayment
    ? false
    : listing.format === "fixed"
      ? Boolean(listing.buyerId)
      : listing.outcome != null;
  if (priceCents === undefined || alreadySold) {
    redirect(`/listing/${id}`);
  }

  const watchStatus = await getWatchStatus(listing.id, local.accessToken).catch(() => null);

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />

      <div className="w-full px-10 py-6 sm:px-12 lg:px-14">
        <Link
          href={`/listing/${id}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-brand-navy"
        >
          <ArrowLeft size={15} /> Back to listing
        </Link>

        <nav className="mb-4 flex items-center gap-1.5 text-xs text-gray-500">
          <Link href="/" className="hover:text-brand-navy">
            Home
          </Link>
          <ChevronRight size={12} />
          <Link href={`/listing/${id}`} className="hover:text-brand-navy">
            {listing.title}
          </Link>
          <ChevronRight size={12} />
          <span className="text-gray-700">Checkout</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <ListingGallery
              listingId={listing.id}
              imageUrls={listing.imageUrls ?? []}
              watcherCount={watchStatus?.watcherCount ?? listing.watcherCount}
              initialWatching={watchStatus?.watching ?? false}
              isLoggedIn
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

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Truck size={14} />
              {shippingDisplayText(listing)}
            </div>

            <SellerCard username={listing.sellerUsername} tier={listing.sellerTier} />
          </div>

          <aside>
            {isOwner ? (
              <div className="rounded-2xl border border-brand-border bg-white p-8 text-center shadow-sm">
                <p className="text-sm text-gray-500">
                  This is your own listing — you can&apos;t buy it.
                </p>
              </div>
            ) : (
              <div className="sticky top-6">
                <MockCheckout listingId={id} priceCents={priceCents} />
              </div>
            )}
          </aside>
        </div>
      </div>

      <Footer />
    </div>
  );
}
