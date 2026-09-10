"use client";

import { useEffect } from "react";
import type { ShippingPreset } from "@/lib/types";
import {
  TRACKED_ENVELOPE_CENTS,
  SIGNATURE_REQUEST_THRESHOLD_CENTS,
  SIGNATURE_SURCHARGE_APPROX_CENTS,
  formatPrice,
} from "@/lib/types";

// Mirrors apps/api/internal/shipping.PackageRequiredCents exactly — $100
// and up must ship as a tracked package (Shippo), never an envelope
// (Pitney Bowes' IMb tracking only proves transit, not delivery — not
// strong enough evidence once real money is at stake). Checked here only
// as a UX nicety; internal/listing.Create/Update re-validate regardless.
const PACKAGE_REQUIRED_CENTS = 10000;

const FREE_PRESETS: ShippingPreset[] = ["free_envelope", "free_bubble_mailer", "free_box"];

type PresetOption = {
  value: ShippingPreset;
  label: string;
  description: string;
  // A rough, non-binding approximation of what the seller will actually
  // pay for the real label — a live per-listing estimate only exists for
  // shippo_ground_advantage (listing.estimatedShippingCents, quoted at
  // create/edit time), so these are representative figures from real
  // observed rates for this weight class, not a live quote. Envelope
  // mirrors TRACKED_ENVELOPE_CENTS exactly (Pitney Bowes' flat rate
  // doesn't vary by destination); bubble mailer/box are real USPS Ground
  // Advantage quotes seen for these parcel sizes (docs/Shipping_Research.md).
  approxCents: number;
};

// Real quoted range from live USPS Ground Advantage rate-shops at this
// weight class (docs/Shipping_Research.md) — varies by zone/distance,
// which isn't knowable until a real buyer address exists, so a range is
// honestly what's available here rather than a single number.
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

// The Shipping picker body — shared by the Sell wizard's Step3Price and
// the Edit Listing form (EditListingForm), so a pricing-threshold change
// only ever needs to happen in one place. Pure UI: the caller owns
// `value`/`onChange` and passes in whatever "is the final price already
// known" figure applies to its own context (a fixed listing's own price,
// or 0 for an auction, whose final price isn't knowable yet).
export default function ShippingPresetPicker({
  value,
  onChange,
  knownPriceCents,
  referencePriceCents,
}: {
  value: ShippingPreset;
  onChange: (preset: ShippingPreset) => void;
  // >0 when the final price is already known (a fixed-price listing) —
  // gates the one restriction that's actually checkable at this point
  // (free_envelope/tracked_envelope unavailable at $100+). 0 for an
  // auction, whose final price isn't known yet; the backend resolves the
  // real mechanism at sale time instead (shipping.UpgradePreset).
  knownPriceCents: number;
  // Unlike knownPriceCents, this is always whatever price IS known at
  // listing time — an auction's starting bid and/or Buy It Now price, or a
  // fixed listing's own price, whichever is highest. Drives the
  // $250 signature-request lock below (mirrors apps/api/internal/shipping.
  // RequestSignatureFromPrice) — a real, separate rule from the $100/$500
  // final-sale-price ones above, so it's checked against its own prop
  // rather than overloading knownPriceCents.
  referencePriceCents: number;
}) {
  const overPackageThreshold = knownPriceCents > 0 && knownPriceCents >= PACKAGE_REQUIRED_CENTS;
  const overSignatureThreshold = referencePriceCents >= SIGNATURE_REQUEST_THRESHOLD_CENTS;
  const envelopeDisabled = overPackageThreshold || overSignatureThreshold;
  const freeDisabled = overSignatureThreshold;
  const isFreeSelected = FREE_PRESETS.includes(value);

  // Once the seller's price crosses $250, Ground Advantage is the only
  // real option left standing (Free Shipping and Tracked Envelope are both
  // disabled below) — auto-select it rather than leaving whatever was
  // previously chosen looking selectable but disabled underneath it. Only
  // runs when overSignatureThreshold actually flips, not on every
  // keystroke/re-render, so it never fights a seller actively picking a
  // different preset while already over the bar.
  useEffect(() => {
    if (overSignatureThreshold && value !== "shippo_ground_advantage") {
      onChange("shippo_ground_advantage");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overSignatureThreshold]);

  return (
    <div className="flex flex-col gap-2">
      <PresetRadio
        label="Free Shipping"
        description="You pay for shipping — the buyer sees $0."
        checked={isFreeSelected}
        disabled={freeDisabled}
        onSelect={() => onChange("free_bubble_mailer")}
      />

      {isFreeSelected && (
        <div className="ml-4 flex flex-col gap-2 border-l-2 border-gray-200 py-1 pl-4">
          {FREE_OPTIONS.map((opt) => {
            const disabled = freeDisabled || (opt.value === "free_envelope" && overPackageThreshold);
            return (
              <PresetRadio
                key={opt.value}
                label={opt.label}
                description={opt.description}
                approxCost={`~${formatPrice(opt.approxCents)}`}
                checked={value === opt.value}
                disabled={disabled}
                onSelect={() => onChange(opt.value)}
              />
            );
          })}
        </div>
      )}

      <PresetRadio
        label="Tracked Envelope"
        description="Pitney Bowes tracked envelope — the buyer pays this flat rate."
        approxCost={`~${formatPrice(TRACKED_ENVELOPE_CENTS)}`}
        checked={value === "tracked_envelope"}
        disabled={envelopeDisabled}
        onSelect={() => onChange("tracked_envelope")}
      />
      <div>
        <PresetRadio
          label="Tracked Package - Ground Advantage"
          description="Bubble mailer, full tracking. Buyer pays the real rate — shown on your listing once it's live."
          approxCost={SHIPPO_GROUND_ADVANTAGE_APPROX_RANGE}
          checked={value === "shippo_ground_advantage"}
          disabled={false}
          onSelect={() => onChange("shippo_ground_advantage")}
        />
        {overSignatureThreshold && (
          <div className="ml-4 mt-1.5 flex items-start gap-2 rounded-lg border border-brand-gold/30 bg-brand-gold/5 p-2.5">
            <input type="checkbox" checked disabled className="mt-0.5 h-4 w-4 accent-brand-gold" />
            <span className="flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900">Signature Required</span>
                <span className="text-xs font-medium text-gray-500">
                  +~{formatPrice(SIGNATURE_SURCHARGE_APPROX_CENTS)}
                </span>
              </span>
              <span className="block text-xs text-gray-500">
                Required at $250+ — the carrier won't release this package without a signature at
                delivery. Locked on for items this valuable.
              </span>
            </span>
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-gray-400">
        {overSignatureThreshold
          ? "This price requires a tracked package with signature confirmation — free shipping and envelope options aren't available at $250+."
          : overPackageThreshold
            ? "This price requires a tracked package — envelope options aren't available above $100."
            : "Sales of $100+ always ship tracked, and $500+ require a signature — based on the final sale price, not what's picked here."}
      </p>
    </div>
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
