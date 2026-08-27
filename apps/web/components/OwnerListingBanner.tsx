import { Tag } from "lucide-react";

// The "you can't buy your own listing" state, shown in the price box for
// both fixed-price listings (app/listing/[id]/page.tsx) and auctions
// (AuctionPriceBox) — a single shared component so both stay visually
// identical. Previously a single line of small gray text, easy to miss
// next to a big price; a rounded, tinted banner reads as its own distinct
// state at a glance instead.
export default function OwnerListingBanner() {
  return (
    <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-brand-navy/20 bg-brand-navy/5 px-4 py-4 text-center">
      <Tag size={18} className="shrink-0 text-brand-navy" />
      <p className="text-base font-semibold text-brand-navy">This is your listing</p>
    </div>
  );
}
