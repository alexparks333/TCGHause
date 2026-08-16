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
};

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
    router.push(`/listing/${n.listingId}`);
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
                    href={`/listing/${n.listingId}`}
                    role="menuitem"
                    onClick={(e) => {
                      e.preventDefault();
                      handleOpenNotification(n);
                    }}
                    className={`flex items-start gap-2.5 border-b border-brand-border px-4 py-3 text-sm last:border-0 hover:bg-brand-surface ${
                      n.readAt ? "" : "bg-brand-navy/[0.03]"
                    }`}
                  >
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-brand-surface">
                      {n.listingImageUrl && (
                        // Fixed 40px thumbnail in a dropdown row — next/image's
                        // overhead isn't worth it here, same call as
                        // CelebrationToast's own reveal-card thumbnail.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={n.listingImageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
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
                      <span className="mt-0.5 block text-xs text-gray-400">
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
