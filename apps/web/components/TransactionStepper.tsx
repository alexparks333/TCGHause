"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import Avatar from "./Avatar";
import { devAdvanceOrder, type Order, type OrderState } from "@/lib/api";
import { ORDER_OFF_PATH_LABELS, ORDER_STEPS, stepIndexForState } from "@/lib/orderSteps";
import { PAYMENT_WINDOW_MS } from "@/lib/types";
import PaymentCountdown from "./PaymentCountdown";

// States DevAdvanceArrow knows how to push forward one step — mirrors
// apps/api/internal/order.DevAdvance's own switch exactly (awaiting_ship ->
// shipped, shipped -> delivered+claim_window, claim_window -> released).
// Every other state (paid/created/etc. resolve to awaiting_ship within the
// same request that creates them, so a real order is never seen sitting in
// one; released/refunded/cancelled/claim_open are all dead ends) has
// nothing for this button to do, so it just doesn't render.
const DEV_ADVANCEABLE_STATES: OrderState[] = ["awaiting_ship", "shipped", "claim_window"];

// Where a step's bubble goes when it's the current one — one place for all
// of this rather than an inline ternary chain per step, since each step's
// destination has its own reasoning:
// - Paid: diverges by viewer role, and only while state is genuinely
//   unpaid ("created" — payment_pending, ACH already submitted and just
//   clearing, has nothing to click). A buyer needs to actually pay, so
//   goes to the real checkout page. A seller can never pay for their own
//   item — the listing page's own owner-vs-buyer logic (OwnerListingBanner
//   while live, a plain "sold" banner once ended) already says so without
//   this needing its own copy.
// - Awaiting shipment / Shipped: the same /order/{id} page either way for
//   "awaiting shipment" (TransactionsList's actionHref) — the seller gets
//   actionable fulfillment controls there, the buyer a read-only view of
//   the same order. "Shipped" goes one level deeper, to the dedicated
//   tracking page (real carrier checkpoints, not just the order's own
//   shipped_at timestamp) — same page for both sides, since tracking
//   history is read-only for everyone regardless of role.
function resolveStepHref(
  stepState: OrderState,
  orderState: OrderState,
  listingId: string,
  viewerIsSeller: boolean,
  actionHref: string | undefined,
): string | undefined {
  if (stepState === "paid" && orderState === "created") {
    return viewerIsSeller ? `/listing/${listingId}` : `/checkout/${listingId}`;
  }
  if (stepState === "awaiting_ship" && actionHref) {
    return actionHref;
  }
  if (stepState === "shipped") {
    return `/order/${listingId}/tracking`;
  }
  return undefined;
}

// The Transactions list's per-row progress stepper — modeled directly on
// csfloat.com/profile/trades' trade-completion row (seller avatar on the
// left, buyer avatar on the right, a connected line of checkpoint bubbles
// between them), translated to this app's light theme and its own real
// order lifecycle (ORDER_STEPS) instead of a fixed 4-step trade ladder.
// Seller/Buyer are always shown in that fixed left-to-right order —
// unlike TransactionsList's "Buying from X"/"Selling to X" header line
// (viewer-relative), this row is role-relative, with the viewer's own side
// called out via the "You" tag instead of reordering the row per viewer.
export default function TransactionStepper({
  listingId,
  sellerUsername,
  buyerUsername,
  viewerIsSeller,
  state,
  createdAt,
  actionHref,
  onAdvanced,
}: {
  listingId: string;
  sellerUsername?: string;
  buyerUsername?: string;
  viewerIsSeller: boolean;
  state: OrderState;
  // When state is "created" (the order exists but the buyer hasn't paid
  // yet — see createPendingOrderForWin), this order's own createdAt IS the
  // moment the auction closed: the row is inserted right then, before any
  // payment attempt. That makes it the correct start time for the 24h
  // payment window, same PAYMENT_WINDOW_MS constant AuctionPriceBox/
  // BidsTable already race against — no need to separately thread the
  // listing's closedAt down into this component too.
  createdAt: string;
  // Where the "Awaiting shipment" step goes when it's clickable, for both
  // sides of the trade — the same /order/{id} page either way (see
  // TransactionsList), just rendered differently per viewerIsSeller
  // (OrderStatusPanel): the seller gets the actionable label-buying/
  // fulfillment controls, the buyer gets a read-only status view of the
  // exact same order. Originally seller-only, back when clicking through
  // was framed as "the step IS the Ship Now button" — a buyer wanting to
  // check on their own order's status is just as real a reason to click.
  actionHref?: string;
  // Wired up to DevAdvanceArrow below — lets the parent (TransactionsList)
  // patch its own order list with whatever DevAdvance actually returned,
  // same "caller owns the state update" shape as PrintLabelButton's
  // onLabelChanged.
  onAdvanced?: (order: Order) => void;
}) {
  const offPath = ORDER_OFF_PATH_LABELS[state];
  const currentIndex = stepIndexForState(state);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-1 py-2">
      <PartyEndpoint role="Seller" username={sellerUsername} isViewer={viewerIsSeller} />

      {offPath ? (
        <>
          <Connector done={false} tone="urgent" />
          <div className="shrink-0 rounded-full bg-brand-urgent/10 px-4 py-2 text-xs font-semibold text-brand-urgent">
            {offPath}
          </div>
          <Connector done={false} tone="urgent" />
        </>
      ) : (
        ORDER_STEPS.map((step, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const isCurrent = i === currentIndex;
          const reached = currentIndex >= 0 && i <= currentIndex;

          const stepHref = isCurrent
            ? resolveStepHref(step.state, state, listingId, viewerIsSeller, actionHref)
            : undefined;
          const clickable = Boolean(stepHref);

          const bubble = (
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-150 sm:h-9 sm:w-9 ${
                clickable ? "group-hover:scale-110" : ""
              } ${
                done
                  ? "bg-brand-navy text-white"
                  : isCurrent
                    ? "bg-brand-gold text-white ring-4 ring-brand-gold/20"
                    : "bg-gray-200 text-transparent"
              }`}
            >
              {done && <Check size={16} strokeWidth={3} />}
              {isCurrent && <MoreHorizontal size={18} strokeWidth={3} />}
            </span>
          );
          // "Needs Payment" + a live countdown replaces the plain "Paid"
          // label while this step is current AND the order is genuinely
          // unpaid (state === "created" — payment_pending, ACH already
          // submitted and clearing, isn't "needs payment" anymore even
          // though stepIndexForState still parks it on this same bubble).
          const needsPayment = isCurrent && step.state === "paid" && state === "created";
          const dueAt = needsPayment
            ? new Date(new Date(createdAt).getTime() + PAYMENT_WINDOW_MS).toISOString()
            : undefined;

          const labelText = needsPayment ? (
            <span className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-[11px] font-semibold leading-tight text-brand-urgent">
                Needs Payment
              </span>
              <PaymentCountdown dueAt={dueAt!} className="text-[10px]" />
            </span>
          ) : (
            <span
              className={`text-center text-[11px] leading-tight ${
                reached ? "font-medium text-gray-900" : "text-gray-400"
              }`}
            >
              {step.label}
            </span>
          );

          return (
            <div key={step.state} className="flex items-center">
              <Connector done={i === 0 ? reached : currentIndex >= 0 && i - 1 < currentIndex} />
              {clickable ? (
                <Link
                  href={stepHref!}
                  className="group flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24"
                >
                  {bubble}
                  {labelText}
                </Link>
              ) : (
                <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24">
                  {bubble}
                  {labelText}
                </div>
              )}
              {isCurrent && DEV_ADVANCEABLE_STATES.includes(step.state) && (
                <DevAdvanceArrow listingId={listingId} onAdvanced={onAdvanced} />
              )}
            </div>
          );
        })
      )}

      <Connector done={!offPath && currentIndex === ORDER_STEPS.length - 1} tone={offPath ? "urgent" : "default"} />
      <PartyEndpoint role="Buyer" username={buyerUsername} isViewer={!viewerIsSeller} />
    </div>
  );
}

// Only ever mounted when NODE_ENV=development — checked inline the same
// way SellWizard's Step3Price hides its 1/2/5-minute dev auction durations
// (CLAUDE.md §6.13), so this whole branch is dead-code-eliminated from
// production bundles, not just hidden. There is no realistic way to test
// the shipping/delivery/claim-window flow end to end otherwise — you can't
// actually mail a card to yourself as part of a dev loop — so this button
// stands in for "the seller shipped it" / "the carrier delivered it" /
// "the claim window elapsed," one real state transition at a time, via the
// exact same MarkShipped/MarkDelivered/release code a real event would
// trigger (apps/api/internal/order/devadvance.go). The backend refuses to
// run this outside development regardless of whether this button is even
// rendered (order.AllowDevAdvance) — same belt-and-suspenders shape as
// every other dev-only affordance in this codebase.
function DevAdvanceArrow({
  listingId,
  onAdvanced,
}: {
  listingId: string;
  onAdvanced?: (order: Order) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (process.env.NODE_ENV !== "development") return null;

  async function advance() {
    setBusy(true);
    setError("");
    try {
      const updated = await devAdvanceOrder(listingId);
      onAdvanced?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Advance failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          advance();
        }}
        disabled={busy}
        title="DEV: simulate the next real-world event (ship / deliver / claim window elapses)"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-amber-400 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={15} strokeWidth={3} />}
      </button>
      <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-amber-600">Dev</span>
      {error && <span className="max-w-[80px] text-[9px] text-brand-urgent">{error}</span>}
    </div>
  );
}

function Connector({ done, tone = "default" }: { done: boolean; tone?: "default" | "urgent" }) {
  const color = done ? (tone === "urgent" ? "bg-brand-urgent" : "bg-brand-navy") : "bg-gray-200";
  return <span className={`h-0.5 w-6 shrink-0 sm:w-9 ${color}`} />;
}

function PartyEndpoint({
  role,
  username,
  isViewer,
}: {
  role: "Seller" | "Buyer";
  username?: string;
  isViewer: boolean;
}) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 sm:w-20">
      <span className={isViewer ? "rounded-full ring-2 ring-brand-gold ring-offset-2" : ""}>
        <Avatar label={username ?? role} size={40} />
      </span>
      <span className="text-center text-[11px] leading-tight text-gray-500">
        {role}
        {isViewer && <span className="block font-semibold text-brand-navy">You</span>}
      </span>
    </div>
  );
}
