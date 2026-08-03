"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Listing } from "@/lib/types";

export default function BidBox({ listing }: { listing: Listing }) {
  const router = useRouter();
  const [maxBid, setMaxBid] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const cents = Math.round(Number.parseFloat(maxBid) * 100);
    if (!cents || cents <= 0) {
      setError("Enter a valid bid amount.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    try {
      await apiFetch(`/listings/${listing.id}/bids`, {
        method: "POST",
        body: JSON.stringify({ maxBidCents: cents }),
      });
      setMaxBid("");
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place bid.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          min="0.01"
          required
          value={maxBid}
          onChange={(e) => setMaxBid(e.target.value)}
          placeholder="Your max bid"
          className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="shrink-0 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light disabled:opacity-60"
        >
          {status === "loading" ? "Placing..." : "Place bid"}
        </button>
      </div>
      {error && <p className="text-sm text-brand-urgent">{error}</p>}
      <p className="text-xs text-gray-400">
        This is your private max — the price only rises as far as needed to beat the
        next-highest bidder.
      </p>
    </form>
  );
}
