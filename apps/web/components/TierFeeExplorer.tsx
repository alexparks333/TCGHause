"use client";

import { useState } from "react";
import type { SellerTier } from "@/lib/api";

export type TierOption = {
  name: string;
  tier: SellerTier;
  rate: string; // e.g. "6.00%" — parsed for the math below, still shown verbatim
  accent: string;
};

const EXAMPLE_PRICES = [10, 25, 100, 500];

// eBay's standard final value fee (CLAUDE.md's "~13.25%" is the rounder
// marketing figure this repo quotes elsewhere; 13.75% + $0.30 is the exact
// rate this comparison line uses) — a fixed reference point, not affected
// by which AuctionHous tier is selected above.
const EBAY_RATE_PCT = 13.75;
const EBAY_FLAT_CENTS = 0.3;

// Mirrors pkg/fees.ComputeQuote's flat-rate math exactly (percentage of
// price + a flat $0.30) — verified against the original hardcoded Gold
// numbers before this became interactive: $100 * 6% + $0.30 = $6.30 fee,
// $93.70 net.
function feeAndNet(priceDollars: number, ratePct: number) {
  const fee = priceDollars * (ratePct / 100) + 0.3;
  return { fee, net: priceDollars - fee };
}

function ebayFee(priceDollars: number) {
  return priceDollars * (EBAY_RATE_PCT / 100) + EBAY_FLAT_CENTS;
}

// The "What that looks like" section — starts on the viewer's own tier
// (initialTier, read server-side from their real users.tier so it's never
// a guess) and recomputes live when they click a different tier pill, so
// "what would Gold cost me" is answerable without doing the math by hand.
export default function TierFeeExplorer({
  tiers,
  initialTier,
}: {
  tiers: TierOption[];
  initialTier: SellerTier;
}) {
  const [selected, setSelected] = useState<SellerTier>(initialTier);
  const active = tiers.find((t) => t.tier === selected) ?? tiers[0];
  const ratePct = parseFloat(active.rate);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {tiers.map((t) => (
          <button
            key={t.tier}
            type="button"
            onClick={() => setSelected(t.tier)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              selected === t.tier
                ? "border-brand-navy bg-brand-navy text-white"
                : "border-brand-border bg-white text-gray-600 hover:border-brand-navy/40 hover:text-brand-navy"
            }`}
          >
            {t.name}
            {t.tier === initialTier && (
              <span className={selected === t.tier ? "ml-1 text-white/60" : "ml-1 text-gray-400"}>
                · you
              </span>
            )}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm text-gray-500">
        {active.name} tier ({active.rate} + $0.30), no shipping, no tax.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        {EXAMPLE_PRICES.map((price) => {
          const { fee, net } = feeAndNet(price, ratePct);
          return (
            <div
              key={price}
              className="flex flex-1 min-w-[140px] flex-col items-start gap-1 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-border"
            >
              <p className="text-xs text-gray-500">${price} item</p>
              <p className="text-lg font-bold text-gray-900">${net.toFixed(2)}</p>
              <p className="text-xs text-gray-400">you net · fee ${fee.toFixed(2)}</p>
              <p className="text-xs font-semibold text-brand-urgent">
                eBay&apos;s price comparison: ${ebayFee(price).toFixed(2)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
