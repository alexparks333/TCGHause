"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { devAdjustTier, getMyTier, type SellerTier } from "@/lib/api";
import { formatSellerTier } from "@/lib/types";

const ACCOUNTS = [
  { key: "seller", label: "Seller" },
  { key: "bidderA", label: "Bidder A" },
  { key: "bidderB", label: "Bidder B" },
] as const;

type AccountKey = (typeof ACCOUNTS)[number]["key"];

// Only ever mounted when NODE_ENV=development (see app/layout.tsx) — that
// check happens at build time, so this whole component is dead-code-
// eliminated from production bundles, not just hidden. See
// app/api/dev/switch-user for why this is safe: real sign-ins with real
// pre-seeded accounts, no auth bypass.
//
// currentEmail/accountEmails come from the server (app/layout.tsx reading
// the real verified session + the same DEV_ACCOUNT_*_EMAIL env vars the
// switch-user route uses) so the active account highlight is never a
// client-side guess — same server-fetched-initial-state reasoning as
// WatchBadge/ListingCard, just for a dev-only affordance instead of a
// correctness-critical one.
export default function DevQuickSwitch({
  currentEmail,
  accountEmails,
}: {
  currentEmail: string | null;
  accountEmails: Record<AccountKey, string | null>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const activeKey = ACCOUNTS.find(
    ({ key }) => accountEmails[key] && accountEmails[key] === currentEmail,
  )?.key;

  async function switchTo(account: string) {
    setLoading(account);
    setError("");
    try {
      const res = await fetch("/api/dev/switch-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Switch failed");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Switch failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs shadow-lg">
      <p className="font-mono font-semibold uppercase tracking-wide text-amber-700">
        Dev &middot; Quick switch
      </p>
      <p className="max-w-[220px] truncate text-amber-700">
        {currentEmail ? (
          <>
            Signed in as{" "}
            <span className="font-semibold text-amber-900">
              {activeKey ? ACCOUNTS.find((a) => a.key === activeKey)?.label : currentEmail}
            </span>
          </>
        ) : (
          "Not signed in"
        )}
      </p>
      <div className="flex gap-1.5">
        {ACCOUNTS.map(({ key, label }) => {
          const isActive = key === activeKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => switchTo(key)}
              disabled={loading !== null}
              aria-current={isActive}
              className={`rounded-md border px-2.5 py-1.5 font-medium transition-colors disabled:opacity-50 ${
                isActive
                  ? "border-brand-success bg-brand-success text-white hover:bg-brand-success"
                  : "border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
              }`}
            >
              {loading === key ? "..." : label}
            </button>
          );
        })}
      </div>
      {error && <p className="max-w-[220px] text-brand-urgent">{error}</p>}

      <DevTierAdjuster currentEmail={currentEmail} />

      <Link
        href="/dev/quick-list"
        className="text-amber-800 underline decoration-dotted underline-offset-2 hover:text-amber-900"
      >
        Quick list (no photos)
      </Link>
    </div>
  );
}

// Nudges the CURRENTLY signed-in account's own seller tier up/down one
// step, bypassing every real promotion gate — a raw testing tool for
// seeing what each tier's experience looks like without racking up 500
// real orders and reviews first. Calls the real backend
// (apps/api/internal/seller.DevAdjustTier), which refuses to run at all
// outside development independent of whether this panel is even rendered
// — same belt-and-suspenders shape as switchTo/app/api/dev/switch-user
// above. Re-fetches whenever the signed-in account changes, since tier is
// per-account, not a global dev-panel setting.
function DevTierAdjuster({ currentEmail }: { currentEmail: string | null }) {
  const [tier, setTier] = useState<SellerTier | null>(null);
  const [busy, setBusy] = useState<"up" | "down" | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const status = await getMyTier();
      setTier(status.tier);
      setError("");
    } catch (err) {
      // This component only ever calls refresh() once currentEmail is set
      // (see the early return below), so a failure here is a real problem —
      // e.g. the API server hasn't picked up this route yet, or a migration
      // hasn't been applied — not a "not signed in" case to fail quietly on.
      // Silently swallowing this previously made a broken fetch look
      // identical to a disabled button with nothing wrong.
      setTier(null);
      setError(err instanceof Error ? err.message : "Couldn't load tier");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmail]);

  async function adjust(direction: "up" | "down") {
    setBusy(direction);
    setError("");
    try {
      const { tier: newTier } = await devAdjustTier(direction);
      setTier(newTier);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tier adjust failed");
    } finally {
      setBusy(null);
    }
  }

  if (!currentEmail) return null;

  return (
    <div className="flex flex-col gap-1 border-t border-amber-200 pt-2">
      <p className="text-amber-700">
        Tier:{" "}
        <span className="font-semibold text-amber-900">
          {tier ? formatSellerTier(tier) : "…"}
        </span>
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => adjust("down")}
          disabled={busy !== null || !tier}
          title="Move down one tier"
          className="flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
        >
          <ArrowDown size={12} /> Down
        </button>
        <button
          type="button"
          onClick={() => adjust("up")}
          disabled={busy !== null || !tier}
          title="Move up one tier"
          className="flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
        >
          <ArrowUp size={12} /> Up
        </button>
      </div>
      {error && <p className="max-w-[220px] text-brand-urgent">{error}</p>}
    </div>
  );
}
