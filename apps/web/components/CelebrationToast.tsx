"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DollarSign, Handshake, Star, Trophy, type LucideIcon } from "lucide-react";
import { formatPrice } from "@/lib/types";
import { ackCelebration, type CelebrationItem } from "@/lib/api";

// A kind icon reads at a glance without waiting for a photo to load (or
// having one at all — the dev test items below have none), same reasoning
// as the badges elsewhere in this codebase (NotificationBell's KIND_META,
// the Won/Sold/Lost corner badges). "offer" isn't a real backend
// celebration yet (auction.PendingCelebrations only ever sends win/sale/
// review) — it's here so the dev panel's TN button can preview what it'll
// look like once that feature exists.
const KIND_ICON: Record<"win" | "sale" | "review" | "offer", { Icon: LucideIcon; classes: string }> = {
  win: { Icon: Trophy, classes: "bg-brand-gold/15 text-brand-gold" },
  sale: { Icon: DollarSign, classes: "bg-brand-success/15 text-brand-success" },
  review: { Icon: Star, classes: "bg-amber-400/15 text-amber-400" },
  offer: { Icon: Handshake, classes: "bg-sky-400/15 text-sky-400" },
};

const HOLD_MS = 3200;
// When there's a backlog queued behind this one (e.g. a bunch of
// historical wins/sales that had never been celebrated before this
// feature existed), the hold cuts way short — a single real-time
// celebration still gets the full satisfying ~3.5s, but a pile of ten
// doesn't turn into a full minute of forced waiting to get through them.
const QUICK_HOLD_MS = 1100;
// Must match .animate-celebration-toast-out's duration (globals.css).
const EXIT_MS = 400;

type Phase = "in" | "out";

// A thin, Rust-pickup-style toast for one win/sale/review: slides in at
// the bottom-right corner, holds briefly, then exits by sliding straight
// up off the screen while fading out — rather than the old two-phase
// bouncy burst-into-card, this is a single compact bar the whole way
// through. CelebrationWatcher mounts a fresh instance (keyed by
// listingId+kind) per queued item, so this only ever runs its timeline
// once per item.
export default function CelebrationToast({
  item,
  kind,
  quick = false,
  onDone,
  linkable = true,
}: {
  item: CelebrationItem;
  kind: "win" | "sale" | "review" | "offer";
  // True when more celebrations are queued behind this one.
  quick?: boolean;
  onDone: () => void;
  // False for the dev panel's TN test-notification preview (DevQuickSwitch)
  // — item.listingId there isn't a real listing, so linking to it would 404
  // for no reason. Still clickable either way (see `href` below) — a
  // toast that visibly does nothing when clicked reads as broken, TN
  // preview or not. Every real celebration (from CelebrationWatcher)
  // leaves this at its default.
  linkable?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("in");
  const holdMs = quick ? QUICK_HOLD_MS : HOLD_MS;

  // Ack the moment the toast starts, not on dismiss — a tab closed
  // mid-animation still counts as "seen," so it never plays twice.
  useEffect(() => {
    ackCelebration(item.listingId, kind).catch(() => {});
  }, [item.listingId, kind]);

  useEffect(() => {
    const toOut = setTimeout(() => setPhase("out"), holdMs);
    const toDone = setTimeout(onDone, holdMs + EXIT_MS);
    return () => {
      clearTimeout(toOut);
      clearTimeout(toDone);
    };
  }, [onDone, holdMs]);

  const label =
    kind === "win" ? "Won" : kind === "sale" ? "Sold" : kind === "review" ? "New Review" : "New Offer";
  // A review has no price — it shows the star rating instead. Only a sale
  // reads as money coming in — a win (you paid) or an offer (not yet
  // accepted) don't get the "+" a Rust pickup notification would put on a
  // resource gain.
  const amount =
    kind === "review"
      ? `★ ${(item.rating ?? 0).toFixed(1)}`
      : `${kind === "sale" ? "+" : ""}${formatPrice(item.priceCents)}`;
  const { Icon, classes: iconClasses } = KIND_ICON[kind];

  const cardClassName = `pointer-events-auto flex w-72 items-center gap-3 rounded-lg bg-gray-900/95 py-2.5 pl-2.5 pr-3.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm transition-shadow hover:shadow-black/40 ${
    phase === "out" ? "animate-celebration-toast-out" : "animate-celebration-toast-in"
  }`;

  const content = (
    <>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconClasses}`}>
        <Icon size={18} strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{item.title}</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
      <p className="shrink-0 text-sm font-bold text-gray-200">{amount}</p>
    </>
  );

  // win/sale link to /order/{listingId} — app/order/[id]/page.tsx is keyed
  // by LISTING id, not a real orders.id (it calls getListing(id)/
  // getOrderForListing(id, ...)), and degrades gracefully to its own
  // "shipping isn't wired up yet" copy when no real order row exists yet
  // for that listing — same reasoning as NotificationBell's own
  // won/bought/sold routing. A review has no order concept, so it stays
  // on the listing page.
  const href = !linkable ? "/" : kind === "review" ? `/listing/${item.listingId}` : `/order/${item.listingId}`;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50">
      <Link href={href} className={cardClassName}>
        {content}
      </Link>
    </div>
  );
}
