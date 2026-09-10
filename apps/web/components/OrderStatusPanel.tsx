"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, Loader2, Package, Truck } from "lucide-react";
import {
  addOrderEvidence,
  labelFromOrder,
  shipOrder,
  type EvidenceType,
  type Order,
  type OrderState,
  type ShippingLabel,
} from "@/lib/api";
import { uploadOrderEvidence } from "@/lib/storage";
import { ORDER_STEPS, ORDER_OFF_PATH_LABELS, stepIndexForState } from "@/lib/orderSteps";
import ShippingLabelControl, { isShippingLabelVisible } from "./ShippingLabelControl";

// The real state-machine-driven order-status view (design doc v2 §5) —
// replaces the old "shipping isn't wired up yet" placeholder. Renders
// differently for the seller (label control always available, plus
// fulfillment: evidence upload + mark-shipped while awaiting_ship) vs. the
// buyer (a read-only timeline + arrival-photo prompt).
export default function OrderStatusPanel({
  initialOrder,
  viewerIsSeller,
}: {
  initialOrder: Order;
  viewerIsSeller: boolean;
}) {
  const [order, setOrder] = useState(initialOrder);
  const router = useRouter();

  // Updates this component's own local order state (so the label control
  // and timeline reflect it instantly, no server round-trip needed) *and*
  // triggers a server refetch — OrderReceipt/OrderBuyerCard on the order
  // page are separate Server Components fed from the page's own initial
  // fetch, so without this they'd keep showing "Not yet purchased"/the
  // pre-label earnings number until a manual reload, same
  // no-client-side-source-of-truth reasoning as every other
  // router.refresh() call in this codebase.
  function handleLabelChanged(label: ShippingLabel) {
    setOrder((o) => ({
      ...o,
      labelUrl: label.labelUrl,
      trackingNumber: label.trackingNumber,
      carrier: label.carrier,
      labelCostCents: label.costCents,
    }));
    router.refresh();
  }

  return (
    <div className="mt-6 rounded-2xl border border-brand-border bg-white p-6">
      <Timeline state={order.state} />
      {order.trackingNumber && (
        <p className="mt-4 text-sm text-gray-600">
          {order.carrier} tracking: <span className="font-medium">{order.trackingNumber}</span>
        </p>
      )}
      {order.trackingNumber && order.signatureRequired && (
        <p className="mt-1 text-xs text-gray-500">
          Signature required at delivery — someone will need to be present to sign for it.
        </p>
      )}
      {order.state === "claim_window" && order.claimDeadline && (
        <p className="mt-2 text-xs text-gray-500">
          Funds release to the seller on{" "}
          {new Date(order.claimDeadline).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
          })}{" "}
          unless a claim is opened first.
        </p>
      )}

      {viewerIsSeller && isShippingLabelVisible(order.state, Boolean(order.labelUrl)) && (
        <div className="mt-6 border-t border-brand-border pt-5">
          <ShippingLabelControl
            listingId={order.listingId}
            initialLabel={labelFromOrder(order)}
            shippingPreset={order.shippingPreset}
            signatureRequired={order.signatureRequired}
            state={order.state}
            onLabelChanged={handleLabelChanged}
          />
        </div>
      )}

      {viewerIsSeller && order.state === "awaiting_ship" && (
        <SellerFulfillment order={order} onShipped={setOrder} />
      )}
      {!viewerIsSeller && order.state === "delivered" && (
        <ArrivalPhotoPrompt orderId={order.id} listingId={order.listingId} />
      )}
    </div>
  );
}

function Timeline({ state }: { state: OrderState }) {
  const offPath = ORDER_OFF_PATH_LABELS[state];
  if (offPath) {
    return <p className="text-sm font-semibold text-brand-urgent">{offPath}</p>;
  }

  const currentIndex = stepIndexForState(state);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {ORDER_STEPS.map((step, i) => {
        const done = currentIndex >= 0 && i <= currentIndex;
        return (
          <li key={step.state} className="flex items-center gap-1.5">
            {done ? (
              <CheckCircle2 size={16} className="shrink-0 text-brand-success" />
            ) : (
              <Circle size={16} className="shrink-0 text-gray-300" />
            )}
            <span className={done ? "text-sm font-medium text-gray-900" : "text-sm text-gray-400"}>
              {step.label}
            </span>
            {i < ORDER_STEPS.length - 1 && <span className="mx-1 text-gray-300">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

const REQUIRED_EVIDENCE: { type: EvidenceType; label: string }[] = [
  { type: "card_front", label: "Card — front" },
  { type: "card_back", label: "Card — back" },
  { type: "package_sealed", label: "Sealed package with label" },
];

function SellerFulfillment({
  order,
  onShipped,
}: {
  order: Order;
  onShipped: (order: Order) => void;
}) {
  const [uploaded, setUploaded] = useState<Set<EvidenceType>>(new Set());
  const [busyType, setBusyType] = useState<EvidenceType | null>(null);
  const [carrier, setCarrier] = useState(order.carrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // The shipping label control (rendered by the parent, above this
  // section) owns the actual label state — when a seller buys/changes a
  // label there, it flows back through order.carrier/trackingNumber as new
  // props, and these fields need to pick that up rather than freezing at
  // whatever they were when this component first mounted. React's own
  // recommended pattern for this ("adjusting state when a prop changes",
  // not a useEffect — an Effect here would set state after an extra
  // wasted render) is comparing against the last-seen prop value during
  // render itself.
  const [syncedCarrier, setSyncedCarrier] = useState(order.carrier);
  const [syncedTrackingNumber, setSyncedTrackingNumber] = useState(order.trackingNumber);
  if (order.carrier !== syncedCarrier || order.trackingNumber !== syncedTrackingNumber) {
    setSyncedCarrier(order.carrier);
    setSyncedTrackingNumber(order.trackingNumber);
    setCarrier(order.carrier ?? "");
    setTrackingNumber(order.trackingNumber ?? "");
  }

  async function handleUpload(type: EvidenceType, file: File) {
    setBusyType(type);
    setError("");
    try {
      const url = await uploadOrderEvidence(order.id, file);
      await addOrderEvidence(order.listingId, type, url);
      setUploaded((prev) => new Set(prev).add(type));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusyType(null);
    }
  }

  const allUploaded = REQUIRED_EVIDENCE.every((e) => uploaded.has(e.type));

  async function handleShip() {
    setShipping(true);
    setError("");
    try {
      const updated = await shipOrder(order.listingId, carrier, trackingNumber);
      onShipped(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setShipping(false);
    }
  }

  return (
    <div className="mt-6 border-t border-brand-border pt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Package size={16} /> Fulfill this order
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Upload proof photos, then enter tracking to mark this shipped — required before we&apos;ll
        release payout for it (design doc v2 §5.3).
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {REQUIRED_EVIDENCE.map(({ type, label }) => (
          <div key={type} className="flex items-center justify-between text-sm">
            <span className="text-gray-700">{label}</span>
            <input
              ref={(el) => {
                fileInputs.current[type] = el;
              }}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(type, file);
                e.target.value = "";
              }}
            />
            {uploaded.has(type) ? (
              <span className="flex items-center gap-1 text-xs font-medium text-brand-success">
                <CheckCircle2 size={14} /> Uploaded
              </span>
            ) : (
              <button
                type="button"
                onClick={() => fileInputs.current[type]?.click()}
                disabled={busyType === type}
                className="text-xs font-medium text-brand-navy hover:underline disabled:opacity-60"
              >
                {busyType === type ? <Loader2 size={14} className="animate-spin" /> : "Upload"}
              </button>
            )}
          </div>
        ))}
      </div>

      {allUploaded && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-gray-400">
            Use the shipping label above, or enter tracking manually below if you&apos;re shipping it
            yourself.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
            >
              <option value="">Carrier</option>
              <option value="USPS">USPS</option>
              <option value="UPS">UPS</option>
              <option value="FedEx">FedEx</option>
            </select>
            <input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Tracking number"
              className="flex-1 rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
            />
            <button
              type="button"
              onClick={handleShip}
              disabled={shipping || !carrier || !trackingNumber}
              className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
            >
              <Truck size={14} /> Mark as shipped
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}

function ArrivalPhotoPrompt({ orderId, listingId }: { orderId: string; listingId: string }) {
  const [uploaded, setUploaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function handleUpload(file: File) {
    setBusy(true);
    setError("");
    try {
      const url = await uploadOrderEvidence(orderId, file);
      await addOrderEvidence(listingId, "arrival_photo", url);
      setUploaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (uploaded) {
    return (
      <p className="mt-6 flex items-center gap-1.5 border-t border-brand-border pt-5 text-sm font-medium text-brand-success">
        <CheckCircle2 size={16} /> Arrival photo saved — thanks!
      </p>
    );
  }

  return (
    <div className="mt-6 border-t border-brand-border pt-5">
      <p className="text-sm text-gray-700">
        Photograph the package before unpacking — buyers who do get expedited claim handling if
        anything&apos;s wrong.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
        className="mt-2 text-xs font-medium text-brand-navy hover:underline disabled:opacity-60"
      >
        {busy ? "Uploading…" : "Add a photo (optional)"}
      </button>
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
