"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DollarSign } from "lucide-react";
import { formatPrice } from "@/lib/types";
import { ackCelebration, type CelebrationItem } from "@/lib/api";

const BURST_MS = 1300;
const BURST_EXIT_MS = 300;
const REVEAL_MS = 4000;
const REVEAL_EXIT_MS = 300;

// When there's a backlog queued behind this one (e.g. a bunch of
// historical wins/sales that had never been celebrated before this
// feature existed), the reveal card cuts way short — a single real-time
// celebration still gets the full satisfying ~6s, but a pile of ten
// doesn't turn into a full minute of forced waiting to get through them.
const QUICK_REVEAL_MS = 900;

type Phase = "burst" | "burst-exit" | "reveal" | "reveal-exit";

// Two-phase celebration for one win/sale: a bouncy money-and-headline
// burst, crossfading into a compact card showing exactly what was won or
// sold. CelebrationWatcher mounts a fresh instance (keyed by
// listingId+kind) per queued item, so this only ever runs its timeline
// once per item — it doesn't need to track "have I already played."
export default function CelebrationToast({
  item,
  kind,
  quick = false,
  onDone,
}: {
  item: CelebrationItem;
  kind: "win" | "sale";
  // True when more celebrations are queued behind this one.
  quick?: boolean;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("burst");
  const revealMs = quick ? QUICK_REVEAL_MS : REVEAL_MS;

  // Ack the moment the toast starts, not on dismiss — a tab closed
  // mid-animation still counts as "seen," so it never plays twice.
  useEffect(() => {
    ackCelebration(item.listingId, kind).catch(() => {});
  }, [item.listingId, kind]);

  useEffect(() => {
    const toBurstExit = setTimeout(() => setPhase("burst-exit"), BURST_MS);
    const toReveal = setTimeout(() => setPhase("reveal"), BURST_MS + BURST_EXIT_MS);
    const toRevealExit = setTimeout(
      () => setPhase("reveal-exit"),
      BURST_MS + BURST_EXIT_MS + revealMs
    );
    const toDone = setTimeout(onDone, BURST_MS + BURST_EXIT_MS + revealMs + REVEAL_EXIT_MS);
    return () => {
      clearTimeout(toBurstExit);
      clearTimeout(toReveal);
      clearTimeout(toRevealExit);
      clearTimeout(toDone);
    };
  }, [onDone, revealMs]);

  const headline = kind === "win" ? "Bid Won!" : "Item Sold!";
  const badgeLabel = kind === "win" ? "Won" : "Sold";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      {(phase === "burst" || phase === "burst-exit") && (
        <div
          className={`flex flex-col items-center gap-2 rounded-2xl bg-white px-8 py-6 shadow-2xl ring-1 ring-brand-border ${
            phase === "burst-exit" ? "animate-celebration-fade-out" : "animate-celebration-burst-in"
          }`}
        >
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand-success/10">
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
            <DollarSign size={32} className="text-brand-success" strokeWidth={3} />
          </div>
          <p className="text-xl font-extrabold text-brand-success">{headline}</p>
        </div>
      )}

      {(phase === "reveal" || phase === "reveal-exit") && (
        <Link
          href={`/listing/${item.listingId}`}
          className={`pointer-events-auto flex items-center gap-3 rounded-2xl bg-white p-3 pr-5 shadow-2xl ring-1 ring-brand-border transition-shadow hover:shadow-xl ${
            phase === "reveal-exit"
              ? "animate-celebration-slide-out"
              : "animate-celebration-reveal-in"
          }`}
        >
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-brand-surface">
            {item.imageUrl && (
              // Fixed 56px thumbnail in a short-lived toast — next/image's
              // overhead isn't worth it here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt={item.title} className="h-full w-full object-cover" />
            )}
            <span className="absolute -right-1.5 -top-1.5 rounded-full bg-brand-success px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
              {badgeLabel}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
            <p className="text-xs text-gray-500">{formatPrice(item.priceCents)}</p>
          </div>
        </Link>
      )}
    </div>
  );
}
