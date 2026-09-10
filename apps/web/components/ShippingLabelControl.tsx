"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, Tag, XCircle } from "lucide-react";
import {
  apiFetch,
  buyShippingLabel,
  getMyAddressMine,
  isShippingLabelVisible,
  verifyShippingAddress,
  type Address,
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
  shippo_ground_advantage: "Tracked Package - Ground Advantage",
};

// Ghosted-state visual treatment (dim by default, full opacity on
// hover/focus) mirrors isShippingLabelVisible's own ghosted branch — kept
// as a local list here since it's a rendering detail, not a visibility
// rule other files need.
const GHOSTED_STATES: OrderState[] = ["shipped", "delivered", "claim_window", "claim_open", "released"];

type VerifyStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "valid" }
  | { state: "corrected" }
  | { state: "invalid"; reason: string };

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
  signatureRequired,
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
  // Set once, at order creation, whenever the final sale price crosses
  // shipping.SignatureRequiredCents ($500) — internal/shipping.UpgradePreset
  // already forces the actual purchased label to require a carrier
  // signature at delivery regardless of this UI (BuyLabel passes it
  // straight into Shippo's extra.signature_confirmation), so this prop is
  // purely informational: without it, a seller had no way to know their
  // label would cost a few dollars more than the listing's estimate, and a
  // buyer had no way to know they'd need to be present to sign for it.
  signatureRequired?: boolean;
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

  // Return-address state for the FIRST label purchase on this order — a
  // real seller once bought a label straight off whatever was in Account
  // Settings, with no chance to catch a bad address until Pitney Bowes
  // rejected the purchase outright ("E412 - the delivery information does
  // not match data for this city"), which for a tracked_envelope is a
  // non-refundable charge (see BuyLabel's own doc comment) once it does
  // succeed. Verifying is now a required gate on the FIRST buy, not just
  // "Change Shipping Label" — matching the explicit product decision that
  // a seller must confirm the address before either kind of purchase.
  const [addressLoading, setAddressLoading] = useState(true);
  const [address, setAddress] = useState<Address | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ state: "idle" });

  const ghosted = GHOSTED_STATES.includes(state);
  const needsAddress = isShippingLabelVisible(state, Boolean(label)) && !label;

  useEffect(() => {
    if (!needsAddress) return;
    let cancelled = false;
    getMyAddressMine()
      .then((a) => {
        if (!cancelled) setAddress(a);
      })
      .finally(() => {
        if (!cancelled) setAddressLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // needsAddress is derived from props that don't change after mount in
    // practice (state/label only ever move forward once); fetching once is
    // correct here, same as every other "load my account data" effect in
    // this codebase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // See isShippingLabelVisible's own comment for what each of these two
  // cases means; kept as early returns here (rather than calling that
  // function again) since callers doing their own wrapper-level check
  // already evaluated it before deciding to render this component at all.
  if (!isShippingLabelVisible(state, Boolean(label))) return null;

  function handleLabelChanged(newLabel: ShippingLabel) {
    setLabel(newLabel);
    onLabelChanged?.(newLabel);
  }

  // Runs the same real USPS check a label purchase itself performs. Unlike
  // PrintLabelButton's one-time override (deliberately never persisted),
  // this address IS the seller's permanent Account Settings default — so a
  // correction Pitney Bowes makes here is saved back to their profile via
  // the same /me/address call AddressForm itself uses, otherwise "we fixed
  // this" would be a lie: the actual purchase (which reads the saved
  // address fresh, not whatever's shown here) would still use the old,
  // uncorrected one.
  async function handleVerify() {
    if (!address) return;
    setVerifyStatus({ state: "checking" });
    setError("");
    try {
      const result = await verifyShippingAddress(address);
      if (!result.valid) {
        setVerifyStatus({ state: "invalid", reason: result.errorReason || "This address couldn't be verified." });
        return;
      }
      if (result.corrected && result.normalized) {
        const corrected = { ...address, ...result.normalized };
        setAddress(corrected);
        await apiFetch("/me/address", {
          method: "POST",
          body: JSON.stringify({ ...corrected, line2: corrected.line2 || null, phone: corrected.phone || null }),
        });
        setVerifyStatus({ state: "corrected" });
        return;
      }
      setVerifyStatus({ state: "valid" });
    } catch (err) {
      setVerifyStatus({
        state: "invalid",
        reason: err instanceof Error ? err.message : "Couldn't verify this address.",
      });
    }
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
            {signatureRequired && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-gold">
                <ShieldCheck size={13} /> Signature required at delivery
              </p>
            )}
          </div>
          <PrintLabelButton listingId={listingId} state={state} onLabelChanged={handleLabelChanged} />
        </div>
      </div>
    );
  }

  if (addressLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Loading your return address...
      </div>
    );
  }

  if (!address) {
    return (
      <p className="text-sm text-gray-600">
        Add a return address in{" "}
        <a href="/account/settings" className="font-medium text-brand-navy hover:underline">
          Account Settings
        </a>{" "}
        before buying a shipping label.
      </p>
    );
  }

  const verified = verifyStatus.state === "valid" || verifyStatus.state === "corrected";

  return (
    <div>
      <div className="rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-xs text-gray-700">
        <p className="font-medium text-gray-900">Shipping from</p>
        <p>{address.line1}</p>
        {address.line2 && <p>{address.line2}</p>}
        <p>
          {address.city}, {address.state} {address.postalCode}
        </p>
      </div>

      <button
        type="button"
        onClick={handleVerify}
        disabled={verifyStatus.state === "checking"}
        className="mt-2 flex w-fit items-center gap-1.5 rounded-md border border-brand-border px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-brand-surface disabled:opacity-60"
      >
        {verifyStatus.state === "checking" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <CheckCircle2 size={13} />
        )}
        {verifyStatus.state === "checking" ? "Checking address..." : "Verify address"}
      </button>

      {verifyStatus.state === "valid" && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-brand-success">
          <CheckCircle2 size={13} /> This address is deliverable.
        </p>
      )}
      {verifyStatus.state === "corrected" && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-brand-success">
          <CheckCircle2 size={13} /> Deliverable — we adjusted it to match USPS records, and saved that to your
          account.
        </p>
      )}
      {verifyStatus.state === "invalid" && (
        <p className="mt-1.5 flex items-start gap-1 text-xs text-brand-urgent">
          <XCircle size={13} className="mt-[1px] shrink-0" /> {verifyStatus.reason}
        </p>
      )}
      {!verified && verifyStatus.state !== "checking" && (
        <p className="mt-1 text-[11px] text-gray-400">
          Wrong here? Fix it in{" "}
          <a href="/account/settings" className="text-brand-navy hover:underline">
            Account Settings
          </a>
          , then verify again.
        </p>
      )}

      <button
        type="button"
        onClick={handleBuy}
        disabled={buying || !verified}
        className="mt-3 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-brand-navy px-4 py-2 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5 disabled:opacity-60"
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
      {signatureRequired && (
        <p className="mt-1 flex items-center gap-1 text-xs text-brand-gold">
          <ShieldCheck size={13} /> This sale requires signature confirmation at delivery — adds a
          few dollars to the label cost, already included in your quote.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
