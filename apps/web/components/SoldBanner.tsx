"use client";

import { DollarSign } from "lucide-react";

// The big, hard-to-miss "no longer available" state for a closed listing —
// replaces a single line of gray text that was easy to miss. Deliberately
// echoes CelebrationToast's "Bid Won!"/"Item Sold!" burst (the moneybag
// icon + celebration-burst-in/-float-up keyframes are the same ones that
// component uses) since it's the same kind of moment — but unlike that
// toast, this one never auto-dismisses: it's part of the price box's
// normal render, not a timed overlay, so it just stays until the page
// reloads. Gold rather than CelebrationToast's green/red — matches the
// site's own accent color instead of reading as an alarm.
export default function SoldBanner({ label }: { label: string }) {
  return (
    <div className="animate-celebration-burst-in mt-4 flex flex-col items-center gap-2 rounded-xl bg-brand-gold/10 px-4 py-6 text-center">
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand-gold/15">
        <span
          className="absolute -left-2 -top-2 animate-celebration-float-up text-2xl"
          style={{ animationDelay: "0.1s" }}
        >
          💰
        </span>
        <span
          className="absolute -right-2 -top-1 animate-celebration-float-up text-xl"
          style={{ animationDelay: "0.3s" }}
        >
          💰
        </span>
        <span
          className="absolute -bottom-1 left-1 animate-celebration-float-up text-lg"
          style={{ animationDelay: "0.5s" }}
        >
          💰
        </span>
        <DollarSign size={32} className="text-brand-gold" strokeWidth={3} />
      </div>
      <p className="text-xl font-extrabold text-brand-gold">This Item Sold</p>
      <p className="text-sm text-gray-600">{label}</p>
    </div>
  );
}
