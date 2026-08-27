"use client";

import { useState } from "react";
import { Loader2, Tag } from "lucide-react";
import {
  buyShippingLabel,
  isShippingLabelVisible,
  type OrderState,
  type ShippingLabel,
} from "@/lib/api";
import type { ShippingPreset } from "@/lib/types";
import PrintLabelButton from "./PrintLabelButton";

// Re-exported for existing client-component importers (OrderStatusPanel) —
// the actual definition lives in lib/api.ts now, since a Server Component
// (the listing detail page) needs to call it too, and a "use client"
// module's exports can only be rendered as JSX from a Server Component,
// never invoked as a plain function.
export { isShippingLabelVisible };

const PRESET_LABELS: Record<ShippingPreset, string> = {
  free_envelope: "Envelope (free shipping)",
  free_bubble_mailer: "Bubble Mailer (free shipping)",
  free_box: "Box (free shipping)",
  tracked_envelope: "Tracked Envelope",
  shippo_ground_advantage: "Shippo Ground Advantage (Tracked Package)",
};

// Ghosted-state visual treatment (dim by default, full opacity on
// hover/focus) mirrors isShippingLabelVisible's own ghosted branch — kept
// as a local list here since it's a rendering detail, not a visibility
// rule other files need.
const GHOSTED_STATES: OrderState[] = ["shipped", "delivered", "claim_window", "claim_open", "released"];

// The one shipping-label control, reused on the order page, the listing
// page (for a sold listing the caller owns), and each Transactions row —
// same buy/print/change behavior everywhere, since all three read/write
// the same order row. Owns its own label state (initialized from whatever
// the order already has, see lib/api.ts's labelFromOrder) so it works
// standalone with no parent wiring required; onLabelChanged is only for a
// parent that has its own state to keep in sync (OrderStatusPanel's manual
// carrier/tracking fields, TransactionsList's row).
export default function ShippingLabelControl({
  listingId,
  initialLabel,
  shippingPreset,
  estimatedShippingCents,
  state,
  onLabelChanged,
}: {
  listingId: string;
  initialLabel: ShippingLabel | null;
  shippingPreset?: ShippingPreset;
  // Only meaningful when shippingPreset is "shippo_ground_advantage" — the
  // listing's one-time estimate, shown so the seller knows roughly what a
  // label will cost before buying one.
  estimatedShippingCents?: number;
  // Drives visibility, not just display — see the early returns below.
  // Passing "awaiting_ship" always shows it at full visibility; any other
  // state either ghosts it (if a label exists) or hides it outright (if
  // buying one wouldn't make sense anymore, or doesn't yet).
  state: OrderState;
  onLabelChanged?: (label: ShippingLabel) => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState("");

  const ghosted = GHOSTED_STATES.includes(state);

  // See isShippingLabelVisible's own comment for what each of these two
  // cases means; kept as early returns here (rather than calling that
  // function again) since callers doing their own wrapper-level check
  // already evaluated it before deciding to render this component at all.
  if (!isShippingLabelVisible(state, Boolean(label))) return null;

  function handleLabelChanged(newLabel: ShippingLabel) {
    setLabel(newLabel);
    onLabelChanged?.(newLabel);
  }

  async function handleBuy() {
    setBuying(true);
    setError("");
    try {
      const bought = await buyShippingLabel(listingId);
      handleLabelChanged(bought);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't buy a shipping label.");
    } finally {
      setBuying(false);
    }
  }

  if (label) {
    return (
      <div
        className={`rounded-lg border border-brand-success/30 bg-brand-success/5 p-3 text-sm ${
          ghosted ? "opacity-50 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 font-medium text-brand-success">
              <Tag size={14} /> Label ready — {label.carrier}
              {label.service ? ` ${label.service}` : ""}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Tracking: <span className="font-medium">{label.trackingNumber}</span> · $
              {(label.costCents / 100).toFixed(2)}
            </p>
          </div>
          <PrintLabelButton listingId={listingId} onLabelChanged={handleLabelChanged} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleBuy}
        disabled={buying}
        className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-brand-navy px-4 py-2 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5 disabled:opacity-60"
      >
        {buying ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
        {buying ? "Buying shipping label..." : "Buy Shipping Label"}
      </button>
      {shippingPreset && (
        <p className="mt-1.5 text-xs text-gray-500">
          Ships via {PRESET_LABELS[shippingPreset]}
          {shippingPreset === "shippo_ground_advantage" && estimatedShippingCents != null
            ? ` — est. $${(estimatedShippingCents / 100).toFixed(2)}`
            : ""}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
