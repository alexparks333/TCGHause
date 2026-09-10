"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { apiFetch, verifyShippingAddress, type Address } from "@/lib/api";
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

type VerifyStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "valid" }
  | { state: "corrected" }
  | { state: "invalid"; reason: string };

export default function AddressForm({ currentAddress }: { currentAddress: Address | null }) {
  const [editing, setEditing] = useState(!currentAddress);
  const [form, setForm] = useState<Address>(currentAddress ?? emptyAddress);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ state: "idle" });
  const router = useRouter();

  // Editing any field invalidates the last "Verify address" result — this
  // is the account's default ship-from/ship-to address, used to buy every
  // future tracked_envelope label without a second confirmation step, so
  // a stale checkmark next to fields the seller has since changed would
  // be worse than no checkmark at all.
  function set<K extends keyof Address>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setVerifyStatus({ state: "idle" });
  }

  // Same real USPS lookup a tracked_envelope label purchase itself
  // performs (internal/shipping.PitneyBowesClient.VerifyAddress) — run
  // here, before Save, so a typo surfaces immediately instead of only
  // once a seller tries to buy a label against it later, which for that
  // preset is non-refundable once it succeeds. Doesn't block Save — a
  // failed check is a strong warning, not a hard gate, since USPS's
  // database can lag genuinely new addresses.
  async function handleVerify() {
    setVerifyStatus({ state: "checking" });
    setError("");
    try {
      const result = await verifyShippingAddress(form);
      if (!result.valid) {
        setVerifyStatus({ state: "invalid", reason: result.errorReason || "This address couldn't be verified." });
        return;
      }
      if (result.corrected && result.normalized) {
        setForm((f) => ({ ...f, ...result.normalized }));
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await apiFetch("/me/address", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          line2: form.line2 || null,
          phone: form.phone || null,
        }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save address.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing && currentAddress) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg bg-brand-surface px-3 py-2">
        <div className="text-sm text-gray-900">
          <p className="font-medium">{currentAddress.fullName}</p>
          <p>{currentAddress.line1}</p>
          {currentAddress.line2 && <p>{currentAddress.line2}</p>}
          <p>
            {currentAddress.city}, {currentAddress.state} {currentAddress.postalCode}
          </p>
          <p>{currentAddress.country}</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-sm font-medium text-brand-navy hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  const inputClass =
    "rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
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

      <button
        type="button"
        onClick={handleVerify}
        disabled={verifyStatus.state === "checking"}
        className="flex w-fit items-center gap-1.5 rounded-md border border-brand-border px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-brand-surface disabled:opacity-60"
      >
        {verifyStatus.state === "checking" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <CheckCircle2 size={13} />
        )}
        {verifyStatus.state === "checking" ? "Checking address..." : "Verify address"}
      </button>

      {verifyStatus.state === "valid" && (
        <p className="flex items-center gap-1 text-xs text-brand-success">
          <CheckCircle2 size={13} /> This address is deliverable.
        </p>
      )}
      {verifyStatus.state === "corrected" && (
        <p className="flex items-center gap-1 text-xs text-brand-success">
          <CheckCircle2 size={13} /> Deliverable — we adjusted it to match USPS records above.
        </p>
      )}
      {verifyStatus.state === "invalid" && (
        <p className="flex items-start gap-1 text-xs text-brand-urgent">
          <XCircle size={13} className="mt-[1px] shrink-0" /> {verifyStatus.reason}
        </p>
      )}

      {error && <p className="text-xs text-brand-urgent">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {submitting ? "Saving..." : "Save"}
        </button>
        {currentAddress && (
          <button
            type="button"
            onClick={() => {
              setForm(currentAddress);
              setEditing(false);
              setError("");
              setVerifyStatus({ state: "idle" });
            }}
            className="text-sm text-gray-500 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
