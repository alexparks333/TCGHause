"use client";

import type { FormEvent } from "react";
import type { WizardData, UpdateField } from "../SellWizard";
import { inputClass, labelClass } from "./styles";

// Real product decision (CLAUDE.md §6.1): auctions run 2 days, 3.5 days, or
// 7 days — nothing else. The 1/2/5-minute options only exist to dissect the
// bidding engine without waiting days per test auction, and are compiled out
// of production builds since Next.js sets NODE_ENV="production" for
// `next build`/`next start` automatically (same gating as DevQuickSwitch).
const DURATION_OPTIONS: { label: string; minutes: number }[] = [
  ...(process.env.NODE_ENV === "development"
    ? [
        { label: "1 minute (dev)", minutes: 1 },
        { label: "2 minutes (dev)", minutes: 2 },
        { label: "5 minutes (dev)", minutes: 5 },
      ]
    : []),
  { label: "2 days", minutes: 2 * 24 * 60 },
  { label: "3.5 days", minutes: 3.5 * 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
];

export default function Step3Price({
  data,
  update,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  data: WizardData;
  update: UpdateField;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Set the price</h2>
        <p className="text-sm text-gray-500">Auction or fixed price, plus shipping.</p>
      </div>

      <div className="flex gap-4 rounded-lg bg-brand-surface p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="radio"
            checked={data.format === "auction"}
            onChange={() => update("format", "auction")}
            className="h-4 w-4 accent-brand-navy"
          />
          Auction
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="radio"
            checked={data.format === "fixed"}
            onChange={() => update("format", "fixed")}
            className="h-4 w-4 accent-brand-navy"
          />
          Buy It Now
        </label>
      </div>

      {data.format === "auction" ? (
        <>
          <label className={labelClass}>
            Starting bid ($)
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={data.startingBid}
              onChange={(e) => update("startingBid", e.target.value)}
              className={inputClass}
              placeholder="5.00"
            />
          </label>

          <label className={labelClass}>
            Auction length
            <select
              value={data.durationMinutes}
              onChange={(e) => update("durationMinutes", Number(e.target.value))}
              className={inputClass}
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <label className={labelClass}>
          Price ($)
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={data.price}
            onChange={(e) => update("price", e.target.value)}
            className={inputClass}
            placeholder="24.99"
          />
        </label>
      )}

      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={data.freeShipping}
          onChange={(e) => update("freeShipping", e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
        />
        Free shipping
      </label>

      {!data.freeShipping && (
        <label className={labelClass}>
          Shipping cost ($)
          <input
            type="number"
            min="0"
            step="0.01"
            value={data.shippingCost}
            onChange={(e) => update("shippingCost", e.target.value)}
            className={inputClass}
            placeholder="4.99"
          />
        </label>
      )}

      {error && <p className="text-sm text-brand-urgent">{error}</p>}

      <div className="mt-2 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-gray-300 px-6 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-brand-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {submitting ? "Listing..." : "List it"}
        </button>
      </div>
    </form>
  );
}
