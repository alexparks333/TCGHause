"use client";

import type { FormEvent } from "react";
import type { WizardData, UpdateField } from "../SellWizard";
import MoneyInput from "./MoneyInput";

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
          <div className="flex flex-wrap items-start gap-4">
            <MoneyInput
              label="Starting bid"
              required
              value={data.startingBid}
              onChange={(v) => update("startingBid", v)}
              placeholder="5.00"
            />

            <label className="flex w-48 flex-col gap-1.5 text-sm font-medium text-gray-700">
              Auction length
              <select
                value={data.durationMinutes}
                onChange={(e) => update("durationMinutes", Number(e.target.value))}
                className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3.5 text-base font-semibold text-gray-900 shadow-sm outline-none transition-colors focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.minutes} value={opt.minutes}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                checked={data.buyItNowEnabled}
                onChange={(e) => update("buyItNowEnabled", e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
              />
              Also offer a Buy It Now price
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Buyers can skip bidding and purchase instantly at this price, any time before the
              auction ends.
            </p>

            {data.buyItNowEnabled && (
              <div className="mt-3">
                <MoneyInput
                  label="Buy It Now price"
                  required
                  value={data.buyItNowPrice}
                  onChange={(v) => update("buyItNowPrice", v)}
                  placeholder="49.99"
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <MoneyInput
          label="Price"
          required
          value={data.price}
          onChange={(v) => update("price", v)}
          placeholder="24.99"
        />
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
        <MoneyInput
          label="Shipping cost"
          value={data.shippingCost}
          onChange={(v) => update("shippingCost", v)}
          placeholder="4.99"
        />
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
