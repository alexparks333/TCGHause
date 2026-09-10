"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import {
  getMyNotificationsClient,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import ListingImage from "@/components/ListingImage";

const POLL_MS = 15000;

// A small corner badge on the listing's own photo reads as "what happened,
// on the actual card" at a glance — same visual language as
// CelebrationToast's reveal card and the Won/Sold/Lost badges on
// Buying/Selling, rather than a generic icon that says nothing about which
// listing this is.
const KIND_META: Record<
  AppNotification["kind"],
  { badgeColor: string; badgeLabel: string; text: (title: string) => string }
> = {
  won: { badgeColor: "bg-brand-success", badgeLabel: "Won", text: (t) => `You won ${t}!` },
  bought: {
    badgeColor: "bg-brand-success",
    badgeLabel: "Bought",
    text: (t) => `You bought ${t}!`,
  },
  sold: {
    badgeColor: "bg-brand-success",
    badgeLabel: "Sold",
    text: (t) => `Your listing sold: ${t}`,
  },
  outbid: {
    badgeColor: "bg-brand-urgent",
    badgeLabel: "Outbid",
    text: (t) => `You've been outbid on ${t}`,
  },
  seller_review: {
    badgeColor: "bg-brand-gold",
    badgeLabel: "Review",
    text: (t) => `You got a new review on ${t}`,
  },
  buyer_review: {
    badgeColor: "bg-brand-gold",
    badgeLabel: "Review",
    text: (t) => `The seller left you a review on ${t}`,
  },
  offer_received: {
    badgeColor: "bg-sky-500",
    badgeLabel: "Offer",
    text: (t) => `New offer on ${t}`,
  },
  offer_accepted: {
    badgeColor: "bg-brand-success",
    badgeLabel: "Accepted",
    text: (t) => `Your offer on ${t} was accepted!`,
  },
  offer_declined: {
    badgeColor: "bg-gray-400",
    badgeLabel: "Declined",
    text: (t) => `Your offer on ${t} was declined`,
  },
};

// Where clicking a notification actually goes. won/bought/sold go to
// /order/{listingId} — app/order/[id]/page.tsx is keyed by LISTING id, not
// a real orders.id (it calls getListing(id)/getOrderForListing(id, ...)),
// and degrades gracefully to its own "shipping isn't wired up yet" copy
// when no real order row exists yet for that listing — so this is safe to
// route to unconditionally for these three kinds, no join against orders
// needed. An offer_received always belongs to the listing's own seller,
// so it goes straight to that listing's own Offers panel (only rendered
// for the seller, highlighting this one offer among however many others
// are pending there); offer_accepted/declined always belong to the buyer
// who sent it, so those go to the buyer's own sent-offers list instead;
// everything else (outbid: still just an active auction; the review
// kinds: no order/offer concept fits any better) goes to the plain
// listing page.
function notificationHref(n: AppNotification): string {
  if (n.kind === "won" || n.kind === "bought" || n.kind === "sold") return `/order/${n.listingId}`;
  if (n.kind === "offer_received" && n.offerId) return `/listing/${n.listingId}?offer=${n.offerId}`;
  if ((n.kind === "offer_accepted" || n.kind === "offer_declined") && n.offerId) {
    return `/account/bids-offers?offer=${n.offerId}`;
  }
  return `/listing/${n.listingId}`;
}

// Server-fetched initial state (Header passes these down), then kept
// current with a plain poll — same reasoning as CelebrationWatcher, just a
// persistent list instead of a one-time toast, so there's no "poke on my
// own action" fast path needed here the way the celebration toast has.
export default function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: AppNotification[];
  initialUnreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getMyNotificationsClient();
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Best-effort — a missed poll just gets retried next interval.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleOpenNotification(n: AppNotification) {
    setOpen(false);
    if (!n.readAt) {
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((p) => (p.id === n.id ? { ...p, readAt: new Date().toISOString() } : p))
      );
      markNotificationRead(n.id).catch(() => {});
    }
    router.push(notificationHref(n));
  }

  async function handleMarkAllRead() {
    setUnreadCount(0);
    setNotifications((prev) => prev.map((p) => ({ ...p, readAt: p.readAt ?? new Date().toISOString() })));
    markAllNotificationsRead().catch(() => {});
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
        className="relative flex items-center rounded-md px-2.5 py-2 text-gray-700 transition-colors hover:bg-brand-surface"
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-urgent px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-brand-border bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-brand-border px-4 py-2.5">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-brand-navy hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">No notifications yet.</p>
            ) : (
              notifications.map((n) => {
                const meta = KIND_META[n.kind];
                return (
                  <Link
                    key={n.id}
                    href={notificationHref(n)}
                    role="menuitem"
                    onClick={(e) => {
                      e.preventDefault();
                      handleOpenNotification(n);
                    }}
                    className={`flex items-start gap-2.5 border-b border-brand-border px-4 py-3 text-sm last:border-0 hover:bg-brand-surface ${
                      n.readAt ? "" : "bg-brand-navy/[0.03]"
                    }`}
                  >
                    <div className="relative aspect-[5/7] w-9 shrink-0">
                      {/* The badge sits in this outer, non-clipping wrapper
                          and the photo/placeholder in its own
                          overflow-hidden inner one — the badge is meant to
                          overlap the card's rounded corner, so it can't
                          share a box that clips to that same rounding or
                          the corner poking out gets cut off. */}
                      <div className="h-full w-full overflow-hidden rounded-lg">
                        <ListingImage src={n.listingImageUrl} game={n.listingGame} label={n.listingTitle} />
                      </div>
                      <span
                        className={`absolute -right-1 -top-1 rounded-full px-1 py-0.5 text-[8px] font-bold leading-none text-white shadow ${meta.badgeColor}`}
                      >
                        {meta.badgeLabel}
                      </span>
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className={`block ${n.readAt ? "text-gray-600" : "font-semibold text-gray-900"}`}>
                        {meta.text(n.listingTitle)}
                      </span>
                      {/* Date.now()-based text — see ThreadListItem's
                          matching comment for why this needs
                          suppressHydrationWarning, not a fix elsewhere. */}
                      <span className="mt-0.5 block text-xs text-gray-400" suppressHydrationWarning>
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </span>
                    {!n.readAt && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-navy" />
                    )}
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
