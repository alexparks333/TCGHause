import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Package, Truck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import {
  ApiError,
  getListing,
  getOrderForListing,
  getOrderTracking,
  type TrackingInfo,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { getLocalSession } from "@/lib/session";

// The Shipped step's "whole tracking page" — every carrier checkpoint
// (Shippo's real track-a-shipment API, internal/shipping.TrackShipment),
// not just the current status. Reachable by either side of the trade —
// unlike OrderStatusPanel's seller-only fulfillment controls, tracking
// history is read-only for both, so there's no viewerIsSeller branching
// here at all.
export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [listing, local] = await Promise.all([getListing(id), getLocalSession()]);
  if (!listing) notFound();
  if (!local) redirect("/login");

  let order;
  try {
    order = await getOrderForListing(id, local.accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  // Real participant check against the order itself (buyerId/sellerId),
  // not re-derived from the listing's own fixed-vs-auction buyer fields —
  // the order already resolved that ambiguity once at creation time
  // (order.CreateFromWin), so re-deriving it here would just be a second,
  // possibly-diverging way to ask the same question.
  if (local.userId !== order.buyerId && local.userId !== order.sellerId) {
    redirect(`/listing/${id}`);
  }

  let tracking: TrackingInfo | null = null;
  let trackingError: string | null = null;
  try {
    tracking = await getOrderTracking(id, local.accessToken);
  } catch (err) {
    if (err instanceof ApiError) {
      trackingError = err.message;
    } else {
      throw err;
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="flex-1 px-10 py-12 sm:px-12 lg:px-14">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            href={`/order/${id}`}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-navy"
          >
            <ArrowLeft size={15} /> Back to order
          </Link>

          <div className="rounded-2xl border border-brand-border bg-white p-6">
            <div className="flex items-center gap-4">
              {listing.imageUrls?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={listing.imageUrls[0]}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-lg bg-gradient-to-br from-brand-navy/20 to-brand-gold/20" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-900">{listing.title}</p>
                {order.carrier && order.trackingNumber && (
                  <p className="text-sm text-gray-500">
                    {order.carrier} · {order.trackingNumber}
                  </p>
                )}
              </div>
            </div>

            {trackingError ? (
              <div className="mt-6 rounded-lg bg-brand-surface p-4">
                <p className="text-sm font-medium text-gray-700">Tracking isn&apos;t available right now.</p>
                <p className="mt-1 text-xs text-gray-500">{trackingError}</p>
              </div>
            ) : (
              tracking && (
                <>
                  <div className="mt-6 flex items-start gap-3 rounded-xl bg-brand-surface p-4">
                    <StatusIcon status={tracking.status} />
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{statusLabel(tracking.status)}</p>
                      <p className="text-sm text-gray-600">{tracking.statusDetails}</p>
                      {tracking.eta && tracking.status !== "DELIVERED" && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          Estimated delivery {formatDateTime(tracking.eta)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-6">
                    <h2 className="mb-3 text-sm font-semibold text-gray-900">Tracking history</h2>
                    {tracking.checkpoints.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        No scan events yet — the carrier hasn&apos;t reported anything since the
                        label was created.
                      </p>
                    ) : (
                      <ol className="flex flex-col">
                        {tracking.checkpoints.map((cp, i) => (
                          <li key={i} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <StatusIcon status={cp.status} size={16} />
                              {i < tracking!.checkpoints.length - 1 && (
                                <span className="my-1 w-px flex-1 bg-brand-border" />
                              )}
                            </div>
                            <div className="pb-5">
                              <p className="text-sm font-medium text-gray-900">
                                {cp.statusDetails}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatDateTime(cp.occurredAt)}
                                {cp.location && (cp.location.city || cp.location.state) && (
                                  <>
                                    {" · "}
                                    {[cp.location.city, cp.location.state].filter(Boolean).join(", ")}
                                  </>
                                )}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </>
              )
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "DELIVERED":
      return "Delivered";
    case "TRANSIT":
      return "In transit";
    case "PRE_TRANSIT":
      return "Label created";
    case "FAILURE":
      return "Delivery issue";
    case "RETURNED":
      return "Returned to sender";
    default:
      return "Status unknown";
  }
}

function StatusIcon({ status, size = 20 }: { status: string; size?: number }) {
  switch (status) {
    case "DELIVERED":
      return <CheckCircle2 size={size} className="mt-0.5 shrink-0 text-brand-success" />;
    case "TRANSIT":
      return <Truck size={size} className="mt-0.5 shrink-0 text-brand-gold" />;
    case "PRE_TRANSIT":
      return <Package size={size} className="mt-0.5 shrink-0 text-gray-400" />;
    case "FAILURE":
    case "RETURNED":
      return <AlertTriangle size={size} className="mt-0.5 shrink-0 text-brand-urgent" />;
    default:
      return <Circle size={size} className="mt-0.5 shrink-0 text-gray-300" />;
  }
}
