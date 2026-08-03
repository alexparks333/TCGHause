"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { apiFetch } from "@/lib/api";

// Real watcher count, real per-user state — no fabricated numbers. Initial
// state comes from the server (the listing detail page already knows the
// session — see getWatchStatus in lib/api.ts), not a client-side auth
// check on mount: that raced the page load and was the actual bug behind
// "watching doesn't save" — a click could fire before the client had
// finished learning it was authenticated, silently falling through to the
// logged-out branch. See CLAUDE.md §6.13/watchlist.
export default function WatchBadge({
  listingId,
  initialCount,
  initialWatching,
  isLoggedIn,
}: {
  listingId: string;
  initialCount: number;
  initialWatching: boolean;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [watching, setWatching] = useState(initialWatching);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (busy) return;
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const status = await apiFetch(`/listings/${listingId}/watch`, {
        method: watching ? "DELETE" : "POST",
      });
      setWatching(status.watching);
      setCount(status.watcherCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update watchlist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={
          isLoggedIn
            ? watching
              ? "Remove from watchlist"
              : "Add to watchlist"
            : "Sign in to watch this listing"
        }
        className="flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur transition-colors hover:bg-white disabled:opacity-60"
      >
        <Heart
          size={14}
          className={watching ? "fill-brand-urgent text-brand-urgent" : "text-gray-500"}
        />
        {count} {count === 1 ? "Watcher" : "Watchers"}
      </button>
      {error && (
        <p className="max-w-[160px] rounded-md bg-white/90 px-2 py-1 text-right text-[11px] text-brand-urgent shadow-sm">
          {error}
        </p>
      )}
    </div>
  );
}
