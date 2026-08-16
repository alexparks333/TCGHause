"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, Package, Truck } from "lucide-react";
import {
  addOrderEvidence,
  shipOrder,
  type EvidenceType,
  type Order,
  type OrderState,
} from "@/lib/api";
import { uploadOrderEvidence } from "@/lib/storage";

// The real state-machine-driven order-status view (design doc v2 §5) —
// replaces the old "shipping isn't wired up yet" placeholder. Renders
// differently for the seller (fulfillment: evidence upload + mark-shipped)
// vs. the buyer (a read-only timeline + arrival-photo prompt), since only
// the seller can act on an order sitting in awaiting_ship.
export default function OrderStatusPanel({
  initialOrder,
  viewerIsSeller,
}: {
  initialOrder: Order;
  viewerIsSeller: boolean;
}) {
  const [order, setOrder] = useState(initialOrder);

  return (
    <div className="mt-6 rounded-2xl border border-brand-border bg-white p-6">
      <Timeline state={order.state} />
      {order.trackingNumber && (
        <p className="mt-4 text-sm text-gray-600">
          {order.carrier} tracking: <span className="font-medium">{order.trackingNumber}</span>
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

      {viewerIsSeller && order.state === "awaiting_ship" && (
        <SellerFulfillment order={order} onShipped={setOrder} />
      )}
      {!viewerIsSeller && order.state === "delivered" && (
        <ArrivalPhotoPrompt orderId={order.id} listingId={order.listingId} />
      )}
    </div>
  );
}

const STEPS: { state: OrderState; label: string }[] = [
  { state: "paid", label: "Paid" },
  { state: "awaiting_ship", label: "Awaiting shipment" },
  { state: "shipped", label: "Shipped" },
  { state: "delivered", label: "Delivered" },
  { state: "claim_window", label: "Claim window" },
  { state: "released", label: "Released to seller" },
];

// A terminal state (refunded/cancelled) or claim_open falls outside the
// happy-path steps above — shown as its own line rather than forced onto
// the linear timeline, since it isn't a step in a sequence so much as an
// exit from it.
const OFF_PATH_LABELS: Partial<Record<OrderState, string>> = {
  cancelled: "Cancelled — refunded in full",
  refunded: "Refunded",
  claim_open: "Claim open — under review",
};

function Timeline({ state }: { state: OrderState }) {
  const offPath = OFF_PATH_LABELS[state];
  if (offPath) {
    return <p className="text-sm font-semibold text-brand-urgent">{offPath}</p>;
  }

  const currentIndex = STEPS.findIndex((s) => s.state === state);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {STEPS.map((step, i) => {
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
            {i < STEPS.length - 1 && <span className="mx-1 text-gray-300">→</span>}
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
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

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
        Upload proof photos, then enter tracking to mark this shipped — required before we'll
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
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
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
        anything's wrong.
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
