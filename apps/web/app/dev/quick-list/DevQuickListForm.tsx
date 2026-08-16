"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { inputClass, labelClass } from "@/components/sell-wizard/styles";

// Same duration options/labels as the real Sell wizard's Step3Price — the
// short ones only work because apps/api gates them on APP_ENV too
// (listing.AllowDevDurations), same as this whole page only existing in dev.
const DURATION_OPTIONS = [
  { label: "1 minute", minutes: 1 },
  { label: "2 minutes", minutes: 2 },
  { label: "5 minutes", minutes: 5 },
  { label: "2 days", minutes: 2 * 24 * 60 },
  { label: "3.5 days", minutes: 3.5 * 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
];

function dollarsToCents(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

export default function DevQuickListForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"auction" | "fixed">("auction");
  const [startingBid, setStartingBid] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [buyItNowEnabled, setBuyItNowEnabled] = useState(false);
  const [buyItNowPrice, setBuyItNowPrice] = useState("");
  const [fixedPrice, setFixedPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (
      format === "auction" &&
      buyItNowEnabled &&
      dollarsToCents(buyItNowPrice) <= dollarsToCents(startingBid)
    ) {
      setError("Buy It Now price must be higher than the starting bid.");
      return;
    }

    setSubmitting(true);
    try {
      const listing = await apiFetch("/listings", {
        method: "POST",
        body: JSON.stringify({
          title,
          game: "Pokémon",
          set: "Dev Test",
          condition: "Near Mint",
          isGraded: false,
          format,
          priceCents: format === "fixed" ? dollarsToCents(fixedPrice) : 0,
          startingBidCents: format === "auction" ? dollarsToCents(startingBid) : 0,
          durationMinutes: format === "auction" ? durationMinutes : 0,
          buyItNowPriceCents:
            format === "auction" && buyItNowEnabled ? dollarsToCents(buyItNowPrice) : 0,
          freeShipping: true,
          imageUrls: [],
        }),
      });
      router.push(`/listing/${listing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <label className={labelClass}>
        Title
        <input
          required
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
          placeholder="Charizard VMAX (dev test)"
        />
      </label>

      <div className="flex gap-4 rounded-lg bg-brand-surface p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="radio"
            checked={format === "auction"}
            onChange={() => setFormat("auction")}
            className="h-4 w-4 accent-brand-navy"
          />
          Auction
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="radio"
            checked={format === "fixed"}
            onChange={() => setFormat("fixed")}
            className="h-4 w-4 accent-brand-navy"
          />
          Buy It Now only
        </label>
      </div>

      {format === "auction" ? (
        <>
          <label className={labelClass}>
            Starting bid ($)
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={startingBid}
              onChange={(e) => setStartingBid(e.target.value)}
              className={inputClass}
              placeholder="5.00"
            />
          </label>

          <label className={labelClass}>
            Auction length
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className={inputClass}
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-gray-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={buyItNowEnabled}
                onChange={(e) => setBuyItNowEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
              />
              Also add a Buy It Now price (&quot;Both&quot;)
            </label>

            {buyItNowEnabled && (
              <label className={`${labelClass} mt-3`}>
                Buy It Now price ($)
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={buyItNowPrice}
                  onChange={(e) => setBuyItNowPrice(e.target.value)}
                  className={inputClass}
                  placeholder="49.99"
                />
              </label>
            )}
          </div>
        </>
      ) : (
        <label className={labelClass}>
          Price ($)
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={fixedPrice}
            onChange={(e) => setFixedPrice(e.target.value)}
            className={inputClass}
            placeholder="24.99"
          />
        </label>
      )}

      {error && <p className="text-sm text-brand-urgent">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded-full bg-brand-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
      >
        {submitting ? "Listing..." : "List it"}
      </button>
    </form>
  );
}
