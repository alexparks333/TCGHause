"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, FileDown, Loader2, RefreshCw, XCircle } from "lucide-react";
import {
  buyShippingLabel,
  downloadShippingLabel,
  getMyAddressMine,
  verifyShippingAddress,
  type Address,
  type OrderState,
  type ShippingLabel,
} from "@/lib/api";
import AddressAutocompleteInput from "@/components/AddressAutocompleteInput";

type VerifyStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "valid" }
  | { state: "corrected" }
  | { state: "invalid"; reason: string };

const emptyAddress: Address = {
  fullName: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  phone: "",
  updatedAt: "",
};

const inputClass =
  "w-full rounded-md border border-brand-border px-2.5 py-1.5 text-xs outline-none focus:border-brand-navy";

// Shared between the order-status page (OrderStatusPanel) and the
// Transactions list rows (TransactionsList) — the one place a seller goes
// once a label already exists, either to grab the PDF again or to replace
// it with a fresh purchase under a different return address. Deliberately
// a dropdown, not two standalone buttons: "Change Shipping Label" is a
// real (test-mode) re-purchase, not something to put one accidental click
// away from the primary action.
//
// "Change Shipping Label" is only ever offered while state is
// awaiting_ship — this used to be reachable at any state (a real bug: a
// seller could buy and record a second label, a different tracking number
// and a real vendor charge, for a package that had already shipped under
// the first one). The backend now 409s past awaiting_ship too
// (internal/shipping.HandleBuyLabel), so this is belt-and-suspenders, same
// shape as every other dev/edge gate in this codebase — but hiding the
// option here is also just the honest UI: there's nothing left to change
// once the package is already gone.
//
// "Change" doesn't buy a fresh label off whatever's in Account Settings —
// it opens this seller's OWN return-address fields (never the buyer's;
// the buyer's shipping destination is fixed once an order exists),
// prefilled from GET /me/address so Account Settings is always the
// starting point, editable for this one label only. Whatever gets typed
// here is sent as fromAddressOverride and used to buy the new label, but
// is never written back to Account Settings — same one-time-substitution
// shape as a dev-only override, just for a real product reason (a seller
// shipping this particular order from a different location than their
// saved default, e.g. a PO box vs. home address).
export default function PrintLabelButton({
  listingId,
  state,
  onLabelChanged,
  className,
}: {
  listingId: string;
  state: OrderState;
  onLabelChanged?: (label: ShippingLabel) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "editing">("menu");
  const [downloading, setDownloading] = useState(false);
  const [changing, setChanging] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState<Address>(emptyAddress);
  const [error, setError] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ state: "idle" });
  const rootRef = useRef<HTMLDivElement | null>(null);

  const canChangeLabel = state === "awaiting_ship";

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMode("menu");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Editing any field invalidates whatever the last "Verify address" check
  // said — a stale green checkmark next to fields the seller has since
  // changed would be actively misleading, worse than showing nothing.
  function set<K extends keyof Address>(key: K, value: string) {
    setAddressForm((f) => ({ ...f, [key]: value }));
    setVerifyStatus({ state: "idle" });
  }

  // Runs the same USPS address check a label purchase itself performs
  // (internal/shipping.PitneyBowesClient.VerifyAddress), but as a
  // standalone, non-purchasing lookup — added after a real seller hit
  // "E412 - the delivery information does not match data for this city"
  // only after already attempting to buy a label, which for the
  // tracked_envelope preset is non-refundable once it succeeds (see
  // BuyLabel's own doc comment). Doesn't block "Buy new label" — a failed
  // verification here is a strong warning, not a hard gate, since USPS's
  // database can occasionally lag genuinely new addresses.
  async function handleVerify() {
    setVerifyStatus({ state: "checking" });
    setError("");
    try {
      const result = await verifyShippingAddress(addressForm);
      if (!result.valid) {
        setVerifyStatus({ state: "invalid", reason: result.errorReason || "This address couldn't be verified." });
        return;
      }
      if (result.corrected && result.normalized) {
        setAddressForm((f) => ({ ...f, ...result.normalized }));
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

  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      await downloadShippingLabel(listingId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't download the label.");
    } finally {
      setDownloading(false);
    }
  }

  async function startEditing() {
    setError("");
    setVerifyStatus({ state: "idle" });
    setMode("editing");
    setLoadingAddress(true);
    try {
      const current = await getMyAddressMine();
      setAddressForm(current ?? emptyAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your address.");
    } finally {
      setLoadingAddress(false);
    }
  }

  async function handleChange() {
    setChanging(true);
    setError("");
    try {
      const label = await buyShippingLabel(listingId, {
        ...addressForm,
        line2: addressForm.line2 || null,
        phone: addressForm.phone || null,
      });
      onLabelChanged?.(label);
      setOpen(false);
      setMode("menu");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't buy a new label.");
    } finally {
      setChanging(false);
    }
  }

  const verified = verifyStatus.state === "valid" || verifyStatus.state === "corrected";

  return (
    <div ref={rootRef} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setMode("menu");
        }}
        className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-brand-navy px-3 py-1.5 text-xs font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5"
      >
        <FileDown size={13} /> Download Shipping Label
        <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && mode === "menu" && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-brand-border bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-brand-surface disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileDown size={14} />
            )}
            {downloading ? "Downloading..." : "Download PDF"}
          </button>
          {canChangeLabel ? (
            <button
              type="button"
              onClick={startEditing}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-brand-surface"
            >
              <RefreshCw size={14} />
              Change Shipping Label
            </button>
          ) : (
            <p className="px-3 py-2 text-left text-[11px] leading-snug text-gray-400">
              The label can&apos;t be changed once the item has shipped.
            </p>
          )}
          {error && <p className="px-3 pb-1.5 text-[11px] text-brand-urgent">{error}</p>}
        </div>
      )}

      {open && mode === "editing" && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-brand-border bg-white p-3 shadow-lg"
        >
          <p className="mb-2 text-xs font-semibold text-gray-900">
            Ship from a different address
          </p>
          <p className="mb-2 text-[11px] leading-snug text-gray-500">
            This is your own return address on the label, not the buyer&apos;s — starts
            from Account Settings, edit just for this one label.
          </p>

          {loadingAddress ? (
            <div className="flex items-center justify-center py-4 text-gray-400">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <input
                value={addressForm.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                placeholder="Full name"
                className={inputClass}
              />
              <AddressAutocompleteInput
                value={addressForm.line1}
                onChange={(v) => set("line1", v)}
                onResolve={(resolved) => {
                  setAddressForm((f) => ({ ...f, ...resolved }));
                  setVerifyStatus({ state: "idle" });
                }}
                placeholder="Address line 1"
                className={inputClass}
              />
              <input
                value={addressForm.line2 ?? ""}
                onChange={(e) => set("line2", e.target.value)}
                placeholder="Address line 2 (optional)"
                className={inputClass}
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  value={addressForm.city}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="City"
                  className={inputClass}
                />
                <input
                  value={addressForm.state}
                  onChange={(e) => set("state", e.target.value)}
                  placeholder="State"
                  className={inputClass}
                />
                <input
                  value={addressForm.postalCode}
                  onChange={(e) => set("postalCode", e.target.value)}
                  placeholder="Postal code"
                  className={inputClass}
                />
                <input
                  value={addressForm.country}
                  onChange={(e) => set("country", e.target.value)}
                  placeholder="Country"
                  className={inputClass}
                />
              </div>
              <input
                value={addressForm.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="Phone"
                className={inputClass}
              />

              <button
                type="button"
                onClick={handleVerify}
                disabled={verifyStatus.state === "checking"}
                className="mt-0.5 flex w-fit items-center gap-1.5 rounded-md border border-brand-border px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-brand-surface disabled:opacity-60"
              >
                {verifyStatus.state === "checking" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={12} />
                )}
                {verifyStatus.state === "checking" ? "Checking address..." : "Verify address"}
              </button>

              {verifyStatus.state === "valid" && (
                <p className="flex items-center gap-1 text-[11px] text-brand-success">
                  <CheckCircle2 size={12} /> This address is deliverable.
                </p>
              )}
              {verifyStatus.state === "corrected" && (
                <p className="flex items-center gap-1 text-[11px] text-brand-success">
                  <CheckCircle2 size={12} /> Deliverable — we adjusted it to match USPS records above.
                </p>
              )}
              {verifyStatus.state === "invalid" && (
                <p className="flex items-start gap-1 text-[11px] text-brand-urgent">
                  <XCircle size={12} className="mt-[1px] shrink-0" /> {verifyStatus.reason}
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-2 text-[11px] text-brand-urgent">{error}</p>}

          {!verified && verifyStatus.state !== "checking" && (
            <p className="mt-2 text-[11px] text-gray-400">Verify the address above before buying.</p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleChange}
              disabled={changing || loadingAddress || !verified}
              className="flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-60"
            >
              {changing && <Loader2 size={13} className="animate-spin" />}
              {changing ? "Buying label..." : "Buy new label"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("menu");
                setError("");
              }}
              disabled={changing}
              className="text-xs text-gray-500 hover:underline disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
