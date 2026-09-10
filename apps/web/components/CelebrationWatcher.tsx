"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getMyCelebrations, type CelebrationItem } from "@/lib/api";
import CelebrationToast from "./CelebrationToast";

// Baseline poll — cmd/worker itself now checks for ended auctions every
// 2s (the real bottleneck for "how fast is the winner decided", since
// outcome = 'sold' can't exist until it runs), so polling much slower than
// that here would just add its own extra lag on top.
const POLL_MS = 3000;

interface QueuedCelebration {
  key: string;
  item: CelebrationItem;
  kind: "win" | "sale" | "review";
}

const PokeCelebrationsContext = createContext<() => void>(() => {});

// Lets any component watching one specific auction (ListingCard,
// AuctionPriceBox) trigger an immediate celebration check the instant it
// sees that auction's own countdown hit zero — this is what makes "you
// just won" feel instantaneous for whoever's actually looking at it end,
// on top of (not instead of) the regular POLL_MS interval, which still
// catches everything else (auctions that closed on a different page, or
// while this tab wasn't open at all).
export function usePokeCelebrations() {
  return useContext(PokeCelebrationsContext);
}

// Polls for any win/sale/review the current user hasn't been shown a
// celebration for yet (migration 0014_win_celebrations, widened by
// 0048_review_celebrations) and plays them one at a time. Wraps the whole
// app (app/layout.tsx) rather than sitting as a leaf sibling, specifically
// so it can hand the poke function above down via context to any
// descendant.
export default function CelebrationWatcher({ children }: { children?: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedCelebration[]>([]);
  const seenKeys = useRef(new Set<string>());

  const poll = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const { wins, sales, reviews } = await getMyCelebrations();
      const fresh: QueuedCelebration[] = [
        ...wins.map((item) => ({ key: `win:${item.listingId}`, item, kind: "win" as const })),
        ...sales.map((item) => ({ key: `sale:${item.listingId}`, item, kind: "sale" as const })),
        ...reviews.map((item) => ({ key: `review:${item.listingId}`, item, kind: "review" as const })),
      ].filter((c) => !seenKeys.current.has(c.key));

      if (fresh.length === 0) return;
      fresh.forEach((c) => seenKeys.current.add(c.key));
      setQueue((q) => [...q, ...fresh]);
    } catch {
      // Best-effort — a missed poll just gets retried next interval.
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // current is derived straight from the queue rather than synced into its
  // own state — one fewer piece of state that could drift out of sync, and
  // onDone just shifts the queue instead of clearing a separate "current"
  // slot.
  const current = queue[0] ?? null;

  return (
    <PokeCelebrationsContext.Provider value={poll}>
      {children}
      {current && (
        <CelebrationToast
          key={current.key}
          item={current.item}
          kind={current.kind}
          quick={queue.length > 1}
          onDone={() => setQueue((q) => q.slice(1))}
        />
      )}
    </PokeCelebrationsContext.Provider>
  );
}
