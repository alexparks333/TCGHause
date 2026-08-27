"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type Address } from "@/lib/api";

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

export default function AddressForm({ currentAddress }: { currentAddress: Address | null }) {
  const [editing, setEditing] = useState(!currentAddress);
  const [form, setForm] = useState<Address>(currentAddress ?? emptyAddress);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  function set<K extends keyof Address>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
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
      <input
        required
        value={form.line1}
        onChange={(e) => set("line1", e.target.value)}
        placeholder="Address line 1"
        className={inputClass}
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
