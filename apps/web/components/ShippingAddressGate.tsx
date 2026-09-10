"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { apiFetch, getMyAddressMine, verifyShippingAddress, type Address } from "@/lib/api";
import AddressAutocompleteInput from "@/components/AddressAutocompleteInput";

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
  "rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy";

type VerifyStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "valid" }
  | { state: "corrected" }
  | { state: "invalid"; reason: string };

// Sits in front of the actual payment UI (MockCheckout) on both the
// "pay for a won bid" and "Buy It Now" paths — added because neither ever
// showed the buyer their own shipping address before charging them.
// Product decision: the buyer must see and confirm this address before
// paying, and explicitly acknowledge that a wrong address here is on
// them — a real correction after the fact means buying a second,
// non-refundable label (for tracked_envelope orders specifically, Pitney
// Bowes' IMb labels can't be voided or refunded at all, see
// internal/shipping.PitneyBowesClient.BuyLabel's own doc comment). Only
// renders {children} (the real payment step) once that acknowledgment is
// given — this is a hard gate, not a warning banner, matching the
// explicit "they have to verify" product decision.
//
// Confirming doesn't unmount this component entirely — see the
// `confirmed` branch below, which keeps rendering a small header on top
// of {children}: a "Change address" control that flips confirmed back to
// false (the checkout page's own "Back to listing" link is a real
// navigation away from checkout, not a way back to just this step, which
// is a real gap a buyer hit live), and a constant, read-only reminder of
// the destination while they're actually typing card details — real
// requests: neither existed at all originally.
export default function ShippingAddressGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState<Address | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Address>(emptyAddress);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ state: "idle" });
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyAddressMine()
      .then((a) => {
        if (cancelled) return;
        setAddress(a);
        if (!a) {
          setForm(emptyAddress);
          setEditing(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Editing invalidates both the last verify result AND the checkbox
  // acknowledgment below — that checkbox was a statement about the OLD
  // field values, not whatever's being typed now.
  function set<K extends keyof Address>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setVerifyStatus({ state: "idle" });
    setAcknowledged(false);
  }

  function startEditing() {
    setForm(address ?? emptyAddress);
    setEditing(true);
    setVerifyStatus({ state: "idle" });
    setSaveError("");
  }

  const current = editing ? form : address;

  async function handleVerify() {
    if (!current) return;
    setVerifyStatus({ state: "checking" });
    try {
      const result = await verifyShippingAddress(current);
      if (!result.valid) {
        setVerifyStatus({ state: "invalid", reason: result.errorReason || "This address couldn't be verified." });
        return;
      }
      if (result.corrected && result.normalized) {
        if (editing) {
          setForm((f) => ({ ...f, ...result.normalized }));
        }
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

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      const saved = await apiFetch("/me/address", {
        method: "POST",
        body: JSON.stringify({ ...form, line2: form.line2 || null, phone: form.phone || null }),
      });
      setAddress(saved);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save that address.");
    } finally {
      setSaving(false);
    }
  }

  // Once confirmed, the address step itself unmounts (replaced by the
  // real payment UI) — but a buyer paying by card still needs two things
  // that used to be missing entirely: a way back that returns to the
  // address step specifically (the checkout page's own "Back to listing"
  // link navigates away from checkout altogether, which isn't the same
  // thing), and a constant reminder of WHERE this is shipping while
  // they're heads-down typing a card number. Both live in this one small
  // header rather than inside the payment components themselves, since
  // every one of them (PlainMockCheckout, SavedMethodPayButton,
  // StripePaymentForm) would otherwise need its own copy. Read-only here
  // on purpose — editing happens by going back, not inline mid-payment.
  if (confirmed) {
    return (
      <>
        {address && (
          <div className="mt-6 rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => setConfirmed(false)}
              className="flex items-center gap-1 font-medium text-brand-navy hover:underline"
            >
              <ArrowLeft size={13} /> Change address
            </button>
            <p className="mt-1.5 text-gray-600">
              Shipping to <span className="font-medium text-gray-900">{address.fullName}</span> — {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state} {address.postalCode}
            </p>
          </div>
        )}
        {children}
      </>
    );
  }

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Loading your shipping address...
      </div>
    );
  }

  const verified = verifyStatus.state === "valid" || verifyStatus.state === "corrected";

  return (
    <div className="mt-6 rounded-lg border border-brand-border p-4">
      <p className="text-sm font-semibold text-gray-900">Confirm Shipping Address</p>
      <p className="mt-1 text-xs text-gray-500">
        Changes to address after order is placed will incur a fee.
      </p>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            required
            value={form.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            placeholder="Full name"
            className={inputClass}
          />
          <AddressAutocompleteInput
            required
            value={form.line1}
            onChange={(v) => set("line1", v)}
            onResolve={(resolved) => {
              setForm((f) => ({ ...f, ...resolved }));
              setVerifyStatus({ state: "idle" });
              setAcknowledged(false);
            }}
            placeholder="Address line 1"
            className={inputClass + " w-full"}
          />
          <input
            value={form.line2 ?? ""}
            onChange={(e) => set("line2", e.target.value)}
            placeholder="Address line 2 (optional)"
            className={inputClass}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="City"
              className={inputClass}
            />
            <input
              required
              value={form.state}
              onChange={(e) => set("state", e.target.value)}
              placeholder="State"
              className={inputClass}
            />
            <input
              required
              value={form.postalCode}
              onChange={(e) => set("postalCode", e.target.value)}
              placeholder="Postal code"
              className={inputClass}
            />
            <input
              required
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              placeholder="Country"
              className={inputClass}
            />
          </div>
          <input
            required
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="Phone"
            className={inputClass}
          />
          {saveError && <p className="text-xs text-brand-urgent">{saveError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-full bg-brand-gold px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save address"}
            </button>
            {address && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSaveError("");
                  setVerifyStatus({ state: "idle" });
                }}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        address && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-brand-surface px-3 py-2 text-sm">
            <div className="text-gray-900">
              <p className="font-medium">{address.fullName}</p>
              <p>{address.line1}</p>
              {address.line2 && <p>{address.line2}</p>}
              <p>
                {address.city}, {address.state} {address.postalCode}
              </p>
            </div>
            <button
              type="button"
              onClick={startEditing}
              className="shrink-0 text-xs font-medium text-brand-navy hover:underline"
            >
              Change
            </button>
          </div>
        )
      )}

      {current && (
        <>
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifyStatus.state === "checking"}
            className="mt-3 flex w-fit items-center gap-1.5 rounded-md border border-brand-border px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-brand-surface disabled:opacity-60"
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
              <CheckCircle2 size={13} /> Deliverable — we adjusted it to match USPS records above.
              {editing && " Save it to keep the fix."}
            </p>
          )}
          {verifyStatus.state === "invalid" && (
            <p className="mt-1.5 flex items-start gap-1 text-xs text-brand-urgent">
              <XCircle size={13} className="mt-[1px] shrink-0" /> {verifyStatus.reason}
            </p>
          )}
        </>
      )}

      {!editing && address && (
        <>
          <label className="mt-3 flex items-start gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
            />
            I confirm this shipping address is correct. If it&apos;s wrong, I&apos;m responsible for any cost to
            fix it after I&apos;ve paid.
          </label>
          <button
            type="button"
            onClick={() => setConfirmed(true)}
            disabled={!acknowledged}
            className="mt-3 w-full rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-60"
          >
            Continue to payment
          </button>
          {!verified && (
            <p className="mt-1.5 text-[11px] text-gray-400">
              We recommend verifying the address above before continuing.
            </p>
          )}
        </>
      )}
    </div>
  );
}
