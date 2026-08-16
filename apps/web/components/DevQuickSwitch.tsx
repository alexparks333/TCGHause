"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
      <Link
        href="/dev/quick-list"
        className="text-amber-800 underline decoration-dotted underline-offset-2 hover:text-amber-900"
      >
        Quick list (no photos)
      </Link>
    </div>
  );
}
