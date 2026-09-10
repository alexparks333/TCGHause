"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Gavel, HandCoins, X, type LucideIcon } from "lucide-react";
import type { MyBid } from "@/lib/types";
import { formatOfferStatus, formatPrice, hasBidEnded, offerStatusBadgeClass } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";
import { acceptOffer, declineOffer, type Offer } from "@/lib/api";
import BidsTable from "./BidsTable";
import Avatar from "./Avatar";

type Mode = "bids" | "offers";

// One offer tagged with which of the two lists it came from — sent
// (fetched from /me/offers/sent, the caller is always the buyer) and
// received (/me/offers/received, the caller is always the seller) are
// inherently disjoint sets, so tagging at merge time is enough to know
// which side of the deal a given row is, no id comparison needed.
type OfferRow = Offer & { role: "sent" | "received" };

// The Bids/Offers tab (account/bids-offers) — modeled on Transactions'
// own Sold/Purchased toggle (TransactionsList): one mode switch up top
// instead of the page being permanently split into separate Active/Ended
// bid tables and a seller-only accept/decline panel that only ever lived
// on each listing's own page. Bids and Offers are two different domains
// (auctions vs. a flat-price negotiation) that happened to share one nav
// tab historically — this keeps that one tab, but makes each domain its
// own real view instead of a stack of unrelated sections.
export default function BidsOffersApp({
  bids,
  sentOffers,
  receivedOffers,
  highlightOfferId,
}: {
  bids: MyBid[];
  sentOffers: Offer[];
  receivedOffers: Offer[];
  // From the notification bell's ?offer= query param.
  highlightOfferId?: string;
}) {
  // Arriving via the notification bell's ?offer= link should land the
  // viewer looking straight at the Offers tab, not default to Bids and
  // leave the thing they clicked through for buried one tab over.
  const [mode, setMode] = useState<Mode>(highlightOfferId ? "offers" : "bids");
  const [received, setReceived] = useState(receivedOffers);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  // Every bid, one list, sorted so the auction closest to closing is
  // always at the top — that's the thing actually worth a bidder's
  // attention, whether they're winning or losing it. A bid that's already
  // resolved (won/lost) has nothing left to race against, so those sink
  // below every still-open auction rather than competing on "time left"
  // (which for them is just "however long ago it ended"), sorted among
  // themselves by most-recently-ended first — same order the old separate
  // Ended table used.
  const sortedBids = useMemo(() => {
    const active = bids.filter((b) => !hasBidEnded(b));
    const ended = bids.filter((b) => hasBidEnded(b));
    active.sort((a, b) => {
      const aTime = a.listing.endsAt ? new Date(a.listing.endsAt).getTime() : Infinity;
      const bTime = b.listing.endsAt ? new Date(b.listing.endsAt).getTime() : Infinity;
      return aTime - bTime;
    });
    ended.sort((a, b) => {
      const aTime = new Date(a.listing.closedAt ?? a.listing.endsAt ?? 0).getTime();
      const bTime = new Date(b.listing.closedAt ?? b.listing.endsAt ?? 0).getTime();
      return bTime - aTime;
    });
    return [...active, ...ended];
  }, [bids]);

  // Sent + received merged into one list — pending offers (whichever side
  // sent them) float to the top since those are the ones actually asking
  // for a decision from someone, resolved ones follow sorted by most
  // recent.
  const allOffers: OfferRow[] = useMemo(() => {
    const rows: OfferRow[] = [
      ...sentOffers.map((o) => ({ ...o, role: "sent" as const })),
      ...received.map((o) => ({ ...o, role: "received" as const })),
    ];
    rows.sort((a, b) => {
      const aPending = a.status === "pending" ? 0 : 1;
      const bPending = b.status === "pending" ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      const aTime = new Date(a.respondedAt ?? a.createdAt).getTime();
      const bTime = new Date(b.respondedAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
    return rows;
  }, [sentOffers, received]);

  async function respond(offerId: string, action: "accept" | "decline") {
    setBusyId(offerId);
    setActionError("");
    try {
      const updated = action === "accept" ? await acceptOffer(offerId) : await declineOffer(offerId);
      setReceived((prev) =>
        prev.map((o) => {
          if (o.id === offerId) return updated;
          // Accepting one offer auto-declines every other still-pending
          // offer on the same listing server-side (internal/offer.Accept)
          // — mirrored here so a stale "pending" row with live Accept/
          // Decline buttons doesn't linger in this tab until a reload.
          if (action === "accept" && o.listingId === updated.listingId && o.status === "pending") {
            return { ...o, status: "declined" as const, respondedAt: updated.respondedAt };
          }
          return o;
        })
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to respond to offer.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex w-fit overflow-hidden rounded-lg border border-brand-border">
        <ModeButton
          icon={Gavel}
          label="Bids"
          count={bids.length}
          active={mode === "bids"}
          onClick={() => setMode("bids")}
        />
        <ModeButton
          icon={HandCoins}
          label="Offers"
          count={allOffers.length}
          active={mode === "offers"}
          onClick={() => setMode("offers")}
        />
      </div>

      {mode === "bids" ? (
        <BidsTable
          items={sortedBids}
          emptyMessage="You don't have any active bids."
          scrollable={sortedBids.length > 12}
        />
      ) : allOffers.length === 0 ? (
        <p className="text-sm text-gray-500">You haven&apos;t sent or received any offers yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {allOffers.map((o) => {
            const counterpartUsername = o.role === "sent" ? o.sellerUsername : o.buyerUsername;
            const name = counterpartUsername ?? "Someone";
            return (
              <div
                key={`${o.role}:${o.id}`}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  o.id === highlightOfferId ? "border-brand-navy bg-brand-navy/5" : "border-brand-border"
                }`}
              >
                <Avatar label={name} size={36} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/listing/${o.listingId}`}
                    className="block truncate text-sm font-semibold text-gray-900 hover:underline"
                  >
                    {o.listingTitle}
                  </Link>
                  {/* Date.now()-based text — see ThreadListItem's matching
                      comment for why this needs suppressHydrationWarning,
                      not a fix elsewhere. */}
                  <p className="text-xs text-gray-500" suppressHydrationWarning>
                    {formatPrice(o.amountCents)} {o.role === "sent" ? "to" : "from"} {name}
                    {" · "}
                    {o.status === "pending"
                      ? formatRelativeTime(o.createdAt)
                      : formatRelativeTime(o.respondedAt ?? o.createdAt)}
                  </p>
                </div>
                {o.role === "received" && o.status === "pending" ? (
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
                    {o.role === "received" && o.status === "pending" ? "Pending" : formatOfferStatus(o.status)}
                  </span>
                )}
              </div>
            );
          })}
          {actionError && <p className="text-xs text-brand-urgent">{actionError}</p>}
        </div>
      )}
    </div>
  );
}

function ModeButton({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? "bg-brand-navy text-white" : "bg-white text-gray-600 hover:bg-brand-surface"
      }`}
    >
      <Icon size={14} />
      {label}
      <span className={active ? "text-white/70" : "text-gray-400"}>{count}</span>
    </button>
  );
}
