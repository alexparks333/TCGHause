import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import OrderStatusPanel from "@/components/OrderStatusPanel";
import ClaimPanel from "@/components/ClaimPanel";
import { ApiError, getListing, getOrderForListing, type Order } from "@/lib/api";
import { formatPrice } from "@/lib/types";
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

  const paidCents = listing.format === "fixed" ? listing.priceCents ?? 0 : listing.currentPriceCents ?? 0;
  const photo = listing.imageUrls?.[0];

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-xl flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <div className="rounded-2xl border border-brand-border bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto text-brand-success" size={40} />
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            {isBuyer ? (wonViaBidding ? "Payment complete!" : "Purchase complete!") : "You sold this!"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isBuyer
              ? wonViaBidding
                ? "You won this auction, and now it's paid for."
                : "Bought with Buy It Now, no bidding required."
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
              Shipping isn&apos;t wired up yet — the seller will be in touch about delivery details
              soon.
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
      </main>
      <Footer />
    </div>
  );
}
