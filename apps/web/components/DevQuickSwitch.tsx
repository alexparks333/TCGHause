"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Minus, Plus } from "lucide-react";
import {
  devAdjustTier,
  devSimulateIncomingMessage,
  getMyTier,
  type CelebrationItem,
  type SellerTier,
} from "@/lib/api";
import { formatSellerTier } from "@/lib/types";
import CelebrationToast from "./CelebrationToast";
import { usePokeMessages } from "./MessageBubbleWatcher";

// A pool of fake win/sale/review/offer items for the dev panel's TN (Test
// Notification) button — lets every CelebrationToast variant be previewed
// on demand while iterating on its look, instead of running a real
// auction or review all the way through a close/poll cycle each time.
// "offer" isn't a real backend celebration yet (see CelebrationToast's
// KIND_ICON comment) — it's here purely so the icon/layout can be
// previewed ahead of that feature existing. listingId is deliberately not
// a real one: CelebrationToast's ackCelebration call for it just no-ops
// (or, for "offer", 400s) server-side, and any network failure is already
// swallowed there too.
const TEST_NOTIFICATIONS: { kind: "win" | "sale" | "review" | "offer"; item: CelebrationItem }[] = [
  {
    kind: "sale",
    item: {
      listingId: "dev-test-notification",
      title: "Charizard VMAX Rainbow Rare - Champion's Path",
      priceCents: 45999,
    },
  },
  {
    kind: "win",
    item: {
      listingId: "dev-test-notification",
      title: "Blastoise - Base Set Holo",
      priceCents: 12500,
    },
  },
  {
    kind: "review",
    item: {
      listingId: "dev-test-notification",
      title: "Pikachu Illustrator Promo",
      priceCents: 0,
      rating: 4.7,
    },
  },
  {
    kind: "offer",
    item: {
      listingId: "dev-test-notification",
      title: "Umbreon Gold Star - POP Series 5",
      priceCents: 32000,
    },
  },
];

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

  // Minimized state persists across reloads (localStorage, not component
  // state) — this panel remounts on every hard navigation (switching
  // accounts alone does a full router.push + refresh), and re-expanding it
  // every single time you switch accounts mid-test defeats the point of
  // minimizing it at all. Starts expanded (matching the server-rendered
  // markup) and only collapses after mount, once localStorage has actually
  // been read — reading it inside useState's initializer would desync from
  // SSR output and trigger a hydration warning.
  const MINIMIZED_KEY = "dev-quick-switch-minimized";
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    setMinimized(localStorage.getItem(MINIMIZED_KEY) === "1");
  }, []);
  function toggleMinimized() {
    setMinimized((prev) => {
      const next = !prev;
      localStorage.setItem(MINIMIZED_KEY, next ? "1" : "0");
      return next;
    });
  }
  // testToastKey increments on every click so mashing the TN button
  // remounts CelebrationToast each time — a fresh key restarts its whole
  // in/hold/out timeline instead of no-oping while one is already
  // showing. showTestToast unmounts it once its own onDone fires, so a
  // finished (translated fully off-screen but still `position: fixed`)
  // toast doesn't linger in the DOM indefinitely. testToast holds
  // whichever TEST_NOTIFICATIONS entry got randomly picked on the last
  // click, so the win/sale/review variant actually varies per click
  // instead of the button only ever previewing one kind.
  const [testToastKey, setTestToastKey] = useState(0);
  const [showTestToast, setShowTestToast] = useState(false);
  const [testToast, setTestToast] = useState(TEST_NOTIFICATIONS[0]);

  // "Get a Message" — unlike TN above, this doesn't fabricate anything
  // client-side: it asks the backend (message.DevSimulateIncoming) to send
  // one real message from some other real user to whoever's signed in
  // right now, then pokes MessageBubbleWatcher's poll so the resulting
  // bubble shows up immediately instead of waiting up to its own 15s
  // interval. Real thread, real row, real poll — the whole reason
  // messages got their own watcher instead of reusing CelebrationToast's
  // fake-preview approach.
  const pokeMessages = usePokeMessages();
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageError, setMessageError] = useState("");

  async function getAMessage() {
    setMessageBusy(true);
    setMessageError("");
    try {
      await devSimulateIncomingMessage();
      pokeMessages();
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : "Failed to send test message");
    } finally {
      setMessageBusy(false);
    }
  }

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

  if (minimized) {
    return (
      <button
        type="button"
        onClick={toggleMinimized}
        title="Expand dev quick switch panel"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wide text-amber-700 shadow-lg transition-colors hover:bg-amber-100"
      >
        <Plus size={12} /> Dev
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono font-semibold uppercase tracking-wide text-amber-700">
          Dev &middot; Quick switch
        </p>
        <button
          type="button"
          onClick={toggleMinimized}
          title="Minimize"
          aria-label="Minimize dev quick switch panel"
          className="rounded-md p-1 text-amber-700 transition-colors hover:bg-amber-100"
        >
          <Minus size={14} />
        </button>
      </div>
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

      <button
        type="button"
        title="Preview a random CelebrationToast variant (win/sale/review) without running a real sale or review"
        onClick={() => {
          const next = TEST_NOTIFICATIONS[Math.floor(Math.random() * TEST_NOTIFICATIONS.length)];
          setTestToast(next);
          setTestToastKey((n) => n + 1);
          setShowTestToast(true);
        }}
        className="self-start rounded-md border border-amber-300 bg-white px-2.5 py-1.5 font-medium text-amber-800 transition-colors hover:bg-amber-100"
      >
        TN <span className="font-normal text-amber-600">(Test Notification)</span>
      </button>
      {showTestToast && (
        <CelebrationToast
          key={testToastKey}
          item={testToast.item}
          kind={testToast.kind}
          onDone={() => setShowTestToast(false)}
          linkable={false}
        />
      )}

      <button
        type="button"
        title="Send a real message from another user, so the top-right message bubble shows up for real"
        onClick={getAMessage}
        disabled={messageBusy || !currentEmail}
        className="self-start rounded-md border border-amber-300 bg-white px-2.5 py-1.5 font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
      >
        {messageBusy ? "..." : "Get a Message"}
      </button>
      {messageError && <p className="max-w-[220px] text-brand-urgent">{messageError}</p>}
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
