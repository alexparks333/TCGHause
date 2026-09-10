import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import OrderStatusPanel from "@/components/OrderStatusPanel";
import ClaimPanel from "@/components/ClaimPanel";
import OrderReceipt from "@/components/OrderReceipt";
import OrderBuyerCard from "@/components/OrderBuyerCard";
import {
  ApiError,
  getBuyerReviewForListing,
  getBuyerStats,
  getListing,
  getOrderForListing,
  type BuyerReview,
  type BuyerStats,
  type Order,
} from "@/lib/api";
import { formatPrice, purchasePriceCents } from "@/lib/types";
import { getLocalSession } from "@/lib/session";

// The confirmation page app/checkout/[id]'s real (or mock, when Stripe
// isn't configured) checkout lands on right after a completed purchase.
// Also doubles as the seller's fulfillment page — a purchase made through
// the real Connect checkout path (internal/order, design doc v2 §5) has a
// real order behind it, rendered below as OrderStatusPanel; a mock-payment
// purchase has none, and this page falls back to its original "shipping
// isn't wired up yet" copy.
export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [listing, local] = await Promise.all([getListing(id), getLocalSession()]);
  if (!listing) notFound();
  if (!local) redirect("/login");

  const isFixedBuyer = listing.format === "fixed" && listing.buyerId === local.userId;
  // Covers both ways an auction ends up with this caller as its buyer:
  // bought outright via Buy It Now (outcome 'bought_now'), or won via
  // regular bidding and then paid for separately (outcome 'sold' — the
  // PayForWonAuction flow from Bids/Offers' "Awaiting Payment" action).
  const isAuctionBuyer =
    listing.format === "auction" &&
    (listing.outcome === "bought_now" || listing.outcome === "sold") &&
    listing.highBidderId === local.userId;
  const wonViaBidding = listing.format === "auction" && listing.outcome === "sold";
  const isBuyer = isFixedBuyer || isAuctionBuyer;
  const isSeller = listing.sellerId === local.userId;

  // Not actually a participant in this sale (a stray visit to the URL, or
  // the purchase never happened) — send them to the real listing instead
  // of showing a confirmation/fulfillment view that isn't theirs.
  if (!isBuyer && !isSeller) {
    redirect(`/listing/${id}`);
  }

  let order: Order | null = null;
  try {
    order = await getOrderForListing(id, local.accessToken);
  } catch (err) {
    // 404 just means this purchase has no real order behind it (the
    // mock-payment path, or a purchase made before internal/order
    // existed) — the page falls back to its original copy below. Any
    // other failure is a real error and should still surface.
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }

  // A won-via-bidding auction gets a real order the instant it closes
  // (internal/auction/close.go's createPendingOrderForWin), state=created,
  // before the buyer has ever visited checkout — landing here first (e.g.
  // clicking a Transactions row before paying) has nothing to confirm yet,
  // so send the buyer straight to the actual next step instead of this
  // page's "Payment complete!" copy, which would be a lie for this order.
  // Not done for payment_pending (ACH already submitted, just clearing) —
  // sending them back to checkout there would risk a second intent.
  if (isBuyer && order?.state === "created") {
    redirect(`/checkout/${id}`);
  }
  const awaitingBuyerPayment = order?.state === "created" || order?.state === "payment_pending";

  // purchasePriceCents (lib/types.ts) — not a raw listing.priceCents/
  // currentPriceCents reimplementation — since a fixed-format listing sold
  // via an accepted offer can close for less than its own asking price
  // (listing.soldPriceCents). Using priceCents directly here would show
  // the original asking price on this confirmation page instead of what
  // the buyer actually paid, the exact bug this was built to fix.
  const paidCents = purchasePriceCents(listing);
  const photo = listing.imageUrls?.[0];

  // Only fetched once there's a real order and a real buyer to review —
  // internal/buyerreview's endpoints both need an actual order behind
  // them (see order/http.go's GetForListing 404 above).
  let buyerStats: BuyerStats | null = null;
  let buyerReview: BuyerReview | null = null;
  if (isSeller && order && listing.buyerUsername) {
    [buyerStats, buyerReview] = await Promise.all([
      getBuyerStats(listing.buyerUsername),
      getBuyerReviewForListing(listing.id, local.accessToken),
    ]);
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      {/* relative + the receipt as an absolutely-positioned sibling: a
          grid/flex column for the receipt would give it a real track that
          eats into the space the centered content centers itself within
          (that's what shifted everything off-center before). Taking the
          receipt out of flow entirely means the max-w-xl content below
          centers on the exact same math regardless of whether the receipt
          renders at all — it just floats in the right margin alongside it. */}
      <main className="relative w-full flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <div className="mx-auto w-full max-w-xl">
          <div className="rounded-2xl border border-brand-border bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto text-brand-success" size={40} />
            <h1 className="mt-4 text-2xl font-bold text-gray-900">
              {isBuyer
                ? awaitingBuyerPayment
                  ? "Almost there — payment pending"
                  : wonViaBidding
                    ? "Payment complete!"
                    : "Purchase complete!"
                : awaitingBuyerPayment
                  ? "Sold — awaiting payment"
                  : "You sold this!"}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {isBuyer
                ? awaitingBuyerPayment
                  ? "Your bank payment is still processing — this can take a few business days."
                  : wonViaBidding
                    ? "You won this auction, and now it's paid for."
                    : "Bought with Buy It Now, no bidding required."
                : awaitingBuyerPayment
                  ? "The buyer still needs to complete payment before you can ship."
                  : "Upload proof of shipment below once it's packed and ready to go."}
            </p>

            <div className="mt-6 flex items-center gap-4 rounded-xl bg-brand-surface p-4 text-left">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="h-16 w-16 rounded-lg bg-gradient-to-br from-brand-navy/20 to-brand-gold/20" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{listing.title}</p>
                <p className="text-sm text-gray-500">{listing.set}</p>
              </div>
              <p className="text-lg font-bold text-gray-900">{formatPrice(paidCents)}</p>
            </div>

            {!order && (
              <p className="mt-6 text-xs text-gray-500">
                Shipping isn&apos;t wired up yet — the seller will be in touch about delivery
                details soon.
              </p>
            )}

            <div className="mt-6 flex justify-center gap-3">
              <Link
                href={`/listing/${listing.id}`}
                className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface"
              >
                View listing
              </Link>
              <Link
                href={isBuyer ? "/account/buy-history" : "/account/selling"}
                className="rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light"
              >
                {isBuyer ? "Go to Buy History" : "Go to Selling"}
              </Link>
            </div>
          </div>

          {order && (
            <>
              <OrderStatusPanel initialOrder={order} viewerIsSeller={isSeller} />
              <ClaimPanel
                listingId={listing.id}
                orderId={order.id}
                orderState={order.state}
                viewerIsSeller={isSeller}
              />
            </>
          )}
        </div>

        {/* Only shown once there's realistically room for it beside the
            centered card without overlapping it (xl and up) — see the
            comment on <main> above for why this floats instead of taking
            a layout track. */}
        {isSeller && order && (
          <div className="absolute right-10 top-16 hidden w-80 sm:right-12 lg:right-14 xl:block">
            <OrderReceipt order={order} listingTitle={listing.title} />
          </div>
        )}
        {isSeller && order && listing.buyerUsername && buyerStats && (
          <div className="absolute left-10 top-16 hidden w-80 sm:left-12 lg:left-14 xl:block">
            <OrderBuyerCard
              username={listing.buyerUsername}
              listingId={listing.id}
              stats={buyerStats}
              existingReview={buyerReview}
              orderState={order.state}
            />
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
