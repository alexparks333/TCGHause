"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { acceptOffer, declineOffer, type Offer } from "@/lib/api";
import { formatOfferStatus, offerStatusBadgeClass, formatPrice } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";
import Avatar from "./Avatar";

// The seller-facing side of internal/offer — server-fetched initial state
// (app/listing/[id]/page.tsx only fetches this for isOwner, same "no
// client-only initial state" reasoning as everywhere else in this
// codebase), then Accept/Decline update local state directly rather than
// refetching the whole list, since the response from either call already
// is the one offer's new state.
//
// Deliberately only ever rendered for the listing's own seller — an
// offer's existence and amount are between one buyer and this seller,
// never visible to anyone else browsing the listing.
export default function OffersPanel({
  initialOffers,
  highlightOfferId,
}: {
  initialOffers: Offer[];
  // From the notification bell's ?offer= query param — the one offer this
  // panel should visually call out, if the caller arrived here from an
  // "offer_received" notification.
  highlightOfferId?: string;
}) {
  const [offers, setOffers] = useState(initialOffers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function respond(offerId: string, action: "accept" | "decline") {
    setBusyId(offerId);
    setError("");
    try {
      const updated = action === "accept" ? await acceptOffer(offerId) : await declineOffer(offerId);
      setOffers((prev) =>
        prev.map((o) => {
          if (o.id === offerId) return updated;
          // Accepting one offer auto-declines every other still-pending
          // offer on the same listing server-side (internal/offer.Accept)
          // — mirrored here so a stale "pending" row with live Accept/
          // Decline buttons doesn't linger in this tab until a reload.
          if (action === "accept" && o.status === "pending") {
            return { ...o, status: "declined" as const, respondedAt: updated.respondedAt };
          }
          return o;
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to respond to offer.");
    } finally {
      setBusyId(null);
    }
  }

  // A declined offer drops off this panel entirely rather than sticking
  // around as history — this is the listing's own live-offers view (the
  // account-wide Bids/Offers page is where a full sent/received history,
  // declined included, actually belongs), and once declined there's
  // nothing left to act on here.
  const visible = offers.filter((o) => o.status !== "declined");
  if (visible.length === 0) return null;

  const pending = visible.filter((o) => o.status === "pending");
  const resolved = visible.filter((o) => o.status !== "pending");

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">
        Offers {pending.length > 0 && <span className="text-brand-navy">({pending.length} pending)</span>}
      </h2>

      <div className="mt-3 flex flex-col gap-2">
        {[...pending, ...resolved].map((o) => (
          <div
            key={o.id}
            className={`flex items-center gap-3 rounded-lg border p-3 ${
              o.id === highlightOfferId ? "border-brand-navy bg-brand-navy/5" : "border-brand-border"
            }`}
          >
            {o.buyerUsername ? (
              <Link href={`/seller/${o.buyerUsername}`} className="shrink-0">
                <Avatar label={o.buyerUsername} size={32} />
              </Link>
            ) : (
              <Avatar label="Someone" size={32} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">
                {formatPrice(o.amountCents)}{" "}
                <span className="font-normal text-gray-500">
                  from{" "}
                  {o.buyerUsername ? (
                    <Link href={`/seller/${o.buyerUsername}`} className="font-medium text-gray-700 hover:underline">
                      {o.buyerUsername}
                    </Link>
                  ) : (
                    "Someone"
                  )}
                </span>
              </p>
              {/* Date.now()-based text — see ThreadListItem's matching
                  comment for why this needs suppressHydrationWarning, not a
                  fix elsewhere. */}
              <p className="text-xs text-gray-400" suppressHydrationWarning>
                {o.status === "pending"
                  ? formatRelativeTime(o.createdAt)
                  : `${formatOfferStatus(o.status)} · ${formatRelativeTime(o.respondedAt ?? o.createdAt)}`}
              </p>
            </div>
            {o.status === "pending" ? (
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => respond(o.id, "accept")}
                  disabled={busyId === o.id}
                  title="Accept"
                  className="flex items-center gap-1 rounded-lg bg-brand-success px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-success/90 disabled:opacity-50"
                >
                  <Check size={13} /> Accept
                </button>
                <button
                  type="button"
                  onClick={() => respond(o.id, "decline")}
                  disabled={busyId === o.id}
                  title="Decline"
                  className="flex items-center gap-1 rounded-lg border border-brand-border px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-brand-surface disabled:opacity-50"
                >
                  <X size={13} /> Decline
                </button>
              </div>
            ) : (
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${offerStatusBadgeClass(o.status)}`}
              >
                {formatOfferStatus(o.status)}
              </span>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
