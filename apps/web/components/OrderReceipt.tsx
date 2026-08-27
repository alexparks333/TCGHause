import { Receipt as ReceiptIcon } from "lucide-react";
import type { Order } from "@/lib/api";
import { formatPrice } from "@/lib/types";

// Short tier label just for this line item — formatSellerTier's "Gold
// Seller" reads fine as a profile badge but is redundant next to "Fee"
// here ("Gold Seller Fee" vs. "Gold Fee").
const TIER_LABELS: Record<string, string> = {
  new: "New",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  haus_trust: "Haus Trust",
};

function formatPct(pct: number): string {
  // Strips a trailing ".0" (6% not 6.0%) without ever collapsing a real
  // fractional rate like Gold's 6.3% down to 6%.
  return `${Number((pct * 100).toFixed(2))}%`;
}

function Line({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={negative ? "text-brand-urgent" : "text-gray-600"}>{label}</dt>
      <dd className={`font-medium ${negative ? "text-brand-urgent" : "text-gray-900"}`}>{value}</dd>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{children}</p>;
}

// Deliberately mirrors eBay's own seller "Order details" receipt shape —
// "What your buyer paid" (their full charge, tax included) on top, "What
// you earned" (that same order total, with the tax AuctionHous collected
// on the state's behalf and AuctionHous's own selling costs subtracted)
// below, landing on the same "Order earnings" number ReleaseFunds
// (internal/order/release.go) actually transfers to the seller's Stripe
// Connect account. Two sections, not one flat list, specifically so it's
// visually obvious that shipping and tax are real dollars the buyer paid
// that never become spendable seller money — shipping is fee-eligible
// (docs/PercentageModel.md §1, "feeing it is fair, matches eBay") but the
// dollars themselves get spent on the label (or partially kept by
// AuctionHous, if the label costs less than the buyer was charged — no
// different from eBay's own model, where "Shipping label" is charged at
// its real cost regardless of what shipping the buyer paid). Tax is
// $0.00 today (Stripe Tax isn't wired up yet, CLAUDE.md §6.12-adjacent
// placeholder) — shown as the real, accurate current value rather than
// hidden, so nothing here is fabricated ahead of that integration landing.
export default function OrderReceipt({ order, listingTitle }: { order: Order; listingTitle: string }) {
  const labelCostCents = order.labelCostCents ?? 0;
  const earningsCents = order.sellerNetCents - labelCostCents;
  const tierLabel = TIER_LABELS[order.tierAtSale] ?? order.tierAtSale;
  const bankDiscount = order.rail === "ach" ? order.discountCents : 0;
  // A seller can also mark an order shipped with a self-purchased label
  // (HandleShip just takes a carrier + tracking number, no purchase
  // required) — if that already happened, order.state has moved past
  // released/refunded with labelCostCents still 0, and that 0 is real:
  // they kept the full shipping charge, nothing is "pending" anymore. Only
  // show the placeholder while the order could still get a label bought
  // through us.
  const labelPending =
    order.shippingCents > 0 && labelCostCents === 0 && order.state !== "released" && order.state !== "refunded";

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <ReceiptIcon size={16} /> Receipt
      </h2>
      <p className="mt-0.5 truncate text-xs text-gray-500">{listingTitle}</p>

      <div className="mt-3">
        <SectionLabel>What your buyer paid</SectionLabel>
      </div>
      <dl className="mt-1.5 flex flex-col gap-2 text-sm">
        <Line label="Subtotal" value={formatPrice(order.subtotalCents)} />
        {bankDiscount > 0 && <Line label="Bank payment discount" value={`-${formatPrice(bankDiscount)}`} negative />}
        <Line label="Shipping" value={order.shippingCents > 0 ? formatPrice(order.shippingCents) : "Free"} />
        <Line label="Sales tax" value={formatPrice(order.taxCents)} />
      </dl>
      <div className="mt-2 flex items-center justify-between border-t border-brand-border pt-2 text-sm">
        <span className="font-semibold text-gray-900">Order total</span>
        <span className="font-semibold text-gray-900">{formatPrice(order.chargedCents)}</span>
      </div>

      <div className="mt-4 border-t border-brand-border pt-1">
        <SectionLabel>What you earned</SectionLabel>
      </div>
      <dl className="mt-1.5 flex flex-col gap-2 text-sm">
        <Line label="Order total" value={formatPrice(order.chargedCents)} />
        {order.taxCents > 0 && (
          <Line label="Sales tax (collected for the state)" value={`-${formatPrice(order.taxCents)}`} negative />
        )}
        <Line
          label={`${tierLabel} Fee (${formatPct(order.tierPctAtSale)})`}
          value={`-${formatPrice(order.sellerFeeCents)}`}
          negative
        />
        {labelCostCents > 0 && <Line label="Shipping label" value={`-${formatPrice(labelCostCents)}`} negative />}
        {labelPending && (
          <div className="flex items-center justify-between">
            <dt className="text-gray-400">Shipping label</dt>
            <dd className="italic text-gray-400">Not yet purchased</dd>
          </div>
        )}
      </dl>
      {labelPending && (
        <p className="mt-1 text-[11px] text-gray-400">
          Its real cost will be deducted here once you print a label for this order.
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-brand-border pt-3">
        <span className="text-sm font-semibold text-gray-900">Order earnings</span>
        <span className="text-lg font-bold text-brand-success">{formatPrice(earningsCents)}</span>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">What&apos;s paid out to you once released.</p>
    </div>
  );
}
