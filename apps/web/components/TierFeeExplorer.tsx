"use client";

import { useState } from "react";
import type { SellerTier } from "@/lib/api";

export type TierOption = {
  name: string;
  tier: SellerTier;
  rate: string; // e.g. "6.00%" — parsed for the math below, still shown verbatim
  accent: string;
};

const EXAMPLE_PRICES = [500, 1000, 5000, 10000, 25000];

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

// Comma-formatted to 2 decimals — EXAMPLE_PRICES now runs up to $25,000
// (graded-slab/vintage territory), where a bare toFixed(2) reads as an
// illegible wall of digits ("23625.00" vs. "23,625.00").
function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

      {/* This row alone breaks out of the page's normal max-w-3xl column —
          `left-1/2 w-screen -translate-x-1/2` re-centers it on the full
          viewport regardless of the parent's width, independent of
          everything else on the page (the tier pills/description above,
          the rest of app/tiers/page.tsx below). Its own max-w + generous
          px is what gives this one area wide margins without touching
          anyone else's. Capped at max-w-7xl so it doesn't stretch edge to
          edge on a very wide monitor. max-w bumped up alongside the px
          increase (not just the px alone) so the cards actually get
          bigger, not squeezed thinner by wider padding eating into the
          same fixed width. */}
      <div className="relative left-1/2 w-screen -translate-x-1/2">
        {/* grid-cols-5, not flex-wrap — a fixed 5-column grid always lays
            out exactly 5 columns per row, so the last card (currently
            $25,000) can never be the lone item wrapped onto its own row
            the way a flex-wrap item with a min-width floor could. Columns
            shrink together at narrower widths instead; text within a card
            wrapping to a second line is fine, a whole card stranding alone
            is what this specifically prevents. */}
        <div className="mx-auto grid max-w-7xl grid-cols-5 gap-4 px-8 py-1 sm:px-20 lg:px-32">
          {EXAMPLE_PRICES.map((price) => {
            const { fee, net } = feeAndNet(price, ratePct);
            return (
              <div
                key={price}
                className="flex min-w-0 flex-col items-start gap-1.5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-border sm:p-5"
              >
                <p className="text-sm text-gray-500">${price.toLocaleString("en-US")} item</p>
                {/* "You net" as its own small label directly above the
                    figure it describes — same idea as "next to," but
                    stacked instead of crammed onto one line, so a 5-digit
                    net amount never wraps mid-number. */}
                <p className="mt-1 text-sm text-gray-400">You net</p>
                <p className="text-xl font-bold text-gray-900 sm:text-2xl">${fmt(net)}</p>
                <p className="text-sm text-gray-400">AuctionHous Fee ${fmt(fee)}</p>
                <p className="text-sm font-semibold text-brand-urgent">eBay&apos;s Fee: ${fmt(ebayFee(price))}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
