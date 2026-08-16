"use client";

import { useState } from "react";
import { Wallet, Zap, Landmark, Clock } from "lucide-react";
import {
  triggerInstantPayout,
  triggerStandardPayout,
  getPayoutSummaryClient,
  type PayoutSummary,
} from "@/lib/api";
import { formatPrice } from "@/lib/types";

// The Withdraw page's whole reason to exist: a wallet balance you can
// actually trust before choosing how to withdraw it. This is the same
// underlying data (internal/payout.GetSummary/ListRecent, one GET
// /me/payout/summary call) design doc v2 §6.3's original "Get paid now"
// button had zero visibility into.
//
// availableCents is exactly what either button below sends: every
// RELEASED order (design doc v2 §5.2 — past its claim window, buyer never
// opened a claim) not yet attached to a payout. pendingCents is real
// money headed to the seller that just isn't THERE yet — a sale still in
// progress somewhere before RELEASED — shown greyed out on purpose so it
// never reads as "also withdrawable right now."
//
// Two buttons, not one, and — deliberately — no third "it happens
// automatically" option: there is no background sweep on this platform
// anymore (apps/api/cmd/worker/main.go's doc comment explains why one
// existed briefly and was removed) — every payout is a direct click,
// Standard (free, ~1-2 business days) or Instant (2% fee, ~30 minutes).
// A seller who never clicks either one just keeps accumulating balance
// here indefinitely, exactly like a real wallet.
export default function WithdrawPanel({ initialSummary }: { initialSummary: PayoutSummary }) {
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState<"standard" | "instant" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setSummary(await getPayoutSummaryClient());
    } catch {
      // Best-effort — keep showing whatever we already had.
    }
  }

  async function handleWithdraw(kind: "standard" | "instant") {
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      const { triggered } = kind === "standard" ? await triggerStandardPayout() : await triggerInstantPayout();
      setMessage(
        triggered
          ? kind === "standard"
            ? "Transfer started — arrives in 1-2 business days."
            : "Instant transfer sent — should land within about 30 minutes."
          : "Nothing available to withdraw right now.",
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || summary.availableCents <= 0;

  return (
    <div className="mt-6">
      {/* The wallet bubble — its own rounded, centered card, deliberately
          not sharing a box with the buttons below it so it reads as "the
          balance" first, "your options for it" second. */}
      <div className="mx-auto flex max-w-sm flex-col items-center rounded-3xl border border-brand-border bg-white px-8 py-10 shadow-sm">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-gold/10 text-brand-gold">
          <Wallet size={26} />
        </span>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-bold text-gray-900">
            {formatPrice(summary.availableCents)}
          </span>
          {summary.pendingCents > 0 && (
            <span className="text-lg font-semibold text-gray-400">
              +{formatPrice(summary.pendingCents)}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Available to withdraw
          {summary.pendingCents > 0 && (
            <>
              {" "}
              — the greyed-out amount is from sales still in progress (not yet shipped, in
              transit, or inside the buyer-protection window after delivery) and
              isn&apos;t withdrawable yet.
            </>
          )}
        </p>
      </div>

      {/* Two buttons below the bubble, each with its own caption directly
          underneath it — not one shared line under both. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => handleWithdraw("standard")}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-1.5 rounded-full border border-brand-border px-5 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:border-brand-navy/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Landmark size={15} />
            {busy === "standard" ? "Sending..." : "Standard Transfer"}
          </button>
          <p className="mt-2 text-center text-xs text-gray-500">
            Free — arrives in 1-2 business days
          </p>
        </div>
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => handleWithdraw("instant")}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Zap size={15} />
            {busy === "instant" ? "Sending..." : "Instant Transfer"}
          </button>
          <p className="mt-2 text-center text-xs text-gray-500">
            2% fee — arrives in about 30 minutes
          </p>
        </div>
      </div>
      {message && <p className="mt-4 text-sm text-brand-success">{message}</p>}
      {error && <p className="mt-4 text-sm text-brand-urgent">{error}</p>}

      <div className="mt-8 rounded-2xl border border-brand-border bg-white p-6 text-left shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Payout history</h2>
        {summary.recent.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No payouts yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-brand-border">
            {summary.recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3 text-sm">
                <div className="flex items-center gap-2 text-gray-500">
                  {p.status === "pending" || p.status === "in_transit" ? (
                    <Clock size={14} className="shrink-0" />
                  ) : null}
                  <span>
                    {new Date(p.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="capitalize">{p.kind}</span>
                  <span className="text-gray-300">·</span>
                  <span
                    className={
                      p.status === "failed"
                        ? "font-medium text-brand-urgent"
                        : p.status === "paid"
                          ? "font-medium text-brand-success"
                          : "font-medium text-gray-500"
                    }
                  >
                    {p.status === "in_transit" ? "on its way" : p.status}
                  </span>
                </div>
                <span className="font-semibold text-gray-900">{formatPrice(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
