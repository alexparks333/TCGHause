"use client";

import { useEffect, useState } from "react";

// Live countdown to endsAt, ticking every second — this is what makes an
// auction card's time-left display (and the "under an hour" seconds
// granularity in formatMsLeft) an actual live countdown instead of a
// number frozen at whatever it was when the page loaded. Recomputes from
// Date.now() on every tick rather than decrementing a counter, so it's
// immune to timer drift or a backgrounded tab's throttled interval.
// Returns null when there's no deadline to count down to (fixed-price
// listings have no endsAt).
export function useMsLeft(endsAt?: string): number | null {
  const target = endsAt ? new Date(endsAt).getTime() : undefined;
  const [msLeft, setMsLeft] = useState(() => (target !== undefined ? target - Date.now() : null));

  useEffect(() => {
    if (target === undefined) return;
    const id = setInterval(() => setMsLeft(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  return msLeft;
}
