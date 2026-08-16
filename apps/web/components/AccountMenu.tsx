"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";
import Avatar from "./Avatar";
import { createClient } from "@/lib/supabase/client";

const ACTIVITY_LINKS = [
  { href: "/account/watchlist", label: "Watchlist" },
  { href: "/account/selling", label: "Selling" },
  { href: "/account/withdraw", label: "Withdraw" },
  { href: "/account/bids-offers", label: "Bids/Offers" },
  { href: "/account/sold-history", label: "Sold History" },
  { href: "/account/buy-history", label: "Buy History" },
  { href: "/account/messages", label: "Messages" },
];

export default function AccountMenu({
  email,
  username,
  fullName,
  avatarUrl,
  unreadMessageCount = 0,
}: {
  email: string;
  username?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  // Real unread-conversation count (internal/message), fetched server-side
  // by Header alongside everything else — same "no client-only initial
  // state" reasoning as NotificationBell's own badge.
  unreadMessageCount?: number;
}) {
  const displayName = username || fullName || email;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group relative hidden items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface sm:flex"
      >
        <span className="relative">
          <Avatar src={avatarUrl} label={displayName} size={26} />
          {unreadMessageCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-urgent ring-2 ring-white" />
          )}
        </span>
        <span className="hidden max-w-[14ch] truncate align-middle transition-[max-width] duration-300 ease-out group-hover:max-w-[240px] lg:inline-block">
          {displayName}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-brand-border bg-white py-1 shadow-lg"
        >
          {ACTIVITY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-brand-surface"
            >
              {link.label}
              {link.href === "/account/messages" && unreadMessageCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-urgent px-1 text-[10px] font-bold text-white">
                  {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
                </span>
              )}
            </Link>
          ))}
          <div className="my-1 border-t border-brand-border" />
          <Link
            href="/account/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-gray-700 hover:bg-brand-surface"
          >
            Account Settings
          </Link>
          <div className="my-1 border-t border-brand-border" />
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-brand-surface"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
