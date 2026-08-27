"use client";

import type { FormEvent } from "react";
import type { WizardData, UpdateField } from "../SellWizard";
import type { ShippingPreset } from "@/lib/types";
import { TRACKED_ENVELOPE_CENTS, formatPrice } from "@/lib/types";
import MoneyInput from "./MoneyInput";

// Mirrors apps/api/internal/shipping.PackageRequiredCents exactly — $100
// and up must ship as a tracked package (Shippo), never an envelope
// (Pitney Bowes' IMb tracking only proves transit, not delivery — not
// strong enough evidence once real money is at stake). Checked here only
// as a UX nicety; internal/listing.Create re-validates regardless.
const PACKAGE_REQUIRED_CENTS = 10000;

const FREE_PRESETS: ShippingPreset[] = ["free_envelope", "free_bubble_mailer", "free_box"];

type PresetOption = {
  value: ShippingPreset;
  label: string;
  description: string;
  // A rough, non-binding approximation of what the seller will actually
  // pay for the real label — there's no listing yet at this point in the
  // wizard to quote a live Shippo rate against (unlike
  // shippingPreset.estimatedShippingCents, computed once a listing
  // exists), so these are representative figures from real observed
  // rates for this weight class, not a live quote. Envelope mirrors
  // TRACKED_ENVELOPE_CENTS exactly (Pitney Bowes' flat rate doesn't vary
  // by destination); bubble mailer/box are real USPS Ground Advantage
  // quotes seen for these parcel sizes (docs/Shipping_Research.md).
  approxCents: number;
};

// The three Free Shipping sub-choices — the seller absorbs the real cost,
// the buyer pays $0, but the buyer still needs to know what's physically
// coming (a bubble mailer looks and feels different from an envelope).
// Only shown once "Free Shipping" itself is selected below — picking a
// packaging without first opting into free shipping doesn't mean
// anything. Valid on auctions too — see envelopeDisabled's comment for
// the one case (free_envelope on a high fixed price) that's actually
// gated.
// Real quoted range from live USPS Ground Advantage rate-shops at this
// weight class (docs/Shipping_Research.md, this feature's own testing) —
// varies by zone/distance, which isn't knowable until a real buyer
// address exists, so a range is honestly what's available here rather
// than a single number. The real per-listing estimate (once one's
// created, see listing.estimatedShippingCents) narrows this to an actual
// quote.
const SHIPPO_GROUND_ADVANTAGE_APPROX_RANGE = `~${formatPrice(517)} – ${formatPrice(1000)}`;

const FREE_OPTIONS: PresetOption[] = [
  {
    value: "free_bubble_mailer",
    label: "Bubble Mailer",
    description: "You cover the cost of a tracked Shippo package.",
    approxCents: 517,
  },
  {
    value: "free_envelope",
    label: "Envelope",
    description: "You cover the cost of a tracked Pitney Bowes envelope.",
    approxCents: TRACKED_ENVELOPE_CENTS,
  },
  {
    value: "free_box",
    label: "Box",
    description: "You cover the cost of a tracked Shippo package.",
    approxCents: 600,
  },
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

  const priceCents = data.format === "fixed" ? Math.round(Number.parseFloat(data.price || "0") * 100) : 0;
  const isFixed = data.format === "fixed";
  const overPackageThreshold = isFixed && priceCents >= PACKAGE_REQUIRED_CENTS;

  // Only the two envelope-mechanism presets (free_envelope,
  // tracked_envelope) are ever disabled, and only when a KNOWN fixed
  // price is already too high — an auction's final price isn't known yet,
  // so both stay selectable there; the backend resolves the real
  // mechanism at sale time (shipping.UpgradePreset), upgrading
  // free_envelope to free_bubble_mailer (still free) or tracked_envelope
  // to shippo_ground_advantage if the auction closes above $100. Free
  // shipping itself is valid on auctions too — free_bubble_mailer/free_box
  // need no gating at all, since they're already package-mechanism at any
  // price; a seller offering free shipping on an auction that closes high
  // just absorbs a bigger bill, same as any other "I cover shipping" offer.
  const envelopeDisabled = overPackageThreshold;

  // The top-level "Free Shipping" bubble is a stand-in for all three
  // free_* presets at once — checked whenever any of them is the current
  // selection, so switching between the packaging sub-choices doesn't
  // read as leaving and re-entering "Free Shipping".
  const isFreeSelected = FREE_PRESETS.includes(data.shippingPreset);

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

      <div>
        <p className="text-sm font-medium text-gray-700">How will you ship this?</p>

        <div className="mt-2 flex flex-col gap-2">
          <PresetRadio
            label="Free Shipping"
            description="You pay for shipping — the buyer sees $0."
            checked={isFreeSelected}
            disabled={false}
            onSelect={() => update("shippingPreset", "free_bubble_mailer")}
          />

          {isFreeSelected && (
            <div className="ml-4 flex flex-col gap-2 border-l-2 border-gray-200 py-1 pl-4">
              {FREE_OPTIONS.map((opt) => {
                const disabled = opt.value === "free_envelope" && overPackageThreshold;
                return (
                  <PresetRadio
                    key={opt.value}
                    label={opt.label}
                    description={opt.description}
                    approxCost={`~${formatPrice(opt.approxCents)}`}
                    checked={data.shippingPreset === opt.value}
                    disabled={disabled}
                    onSelect={() => update("shippingPreset", opt.value)}
                  />
                );
              })}
            </div>
          )}

          <PresetRadio
            label="Tracked Envelope"
            description="Pitney Bowes tracked envelope — the buyer pays this flat rate."
            approxCost={`~${formatPrice(TRACKED_ENVELOPE_CENTS)}`}
            checked={data.shippingPreset === "tracked_envelope"}
            disabled={envelopeDisabled}
            onSelect={() => update("shippingPreset", "tracked_envelope")}
          />
          <PresetRadio
            label="Shippo Ground Advantage (Tracked Package)"
            description="Bubble mailer, full tracking. Buyer pays the real rate — shown on your listing once it's live."
            approxCost={SHIPPO_GROUND_ADVANTAGE_APPROX_RANGE}
            checked={data.shippingPreset === "shippo_ground_advantage"}
            disabled={false}
            onSelect={() => update("shippingPreset", "shippo_ground_advantage")}
          />
        </div>

        <p className="mt-2 text-xs text-gray-400">
          {overPackageThreshold
            ? "This price requires a tracked package — envelope options aren't available above $100."
            : "Sales at $100 or more always ship as a tracked package, and $500 or more requires a signature, regardless of what's picked here — a low starting bid that ends up selling higher will automatically ship at whatever the final price requires."}
        </p>
      </div>

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

function PresetRadio({
  label,
  description,
  approxCost,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  description: string;
  // Shown to the right of the label — a rough "here's what this will
  // probably cost you" figure, not the buyer-facing price (these are all
  // free-shipping sub-choices; the buyer always sees $0 regardless).
  approxCost?: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
        disabled
          ? "cursor-not-allowed border-gray-100 opacity-50"
          : checked
            ? "cursor-pointer border-brand-navy bg-brand-navy/5"
            : "cursor-pointer border-gray-200 hover:bg-brand-surface"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 accent-brand-navy"
      />
      <span className="flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900">{label}</span>
          {approxCost && <span className="text-xs font-medium text-gray-500">{approxCost}</span>}
        </span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
  );
}

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
