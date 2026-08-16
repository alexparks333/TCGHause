"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account/watchlist", label: "Watchlist" },
  { href: "/account/selling", label: "Selling" },
  { href: "/account/withdraw", label: "Withdraw" },
  { href: "/account/bids-offers", label: "Bids/Offers" },
  { href: "/account/sold-history", label: "Sold History" },
  { href: "/account/buy-history", label: "Buy History" },
  { href: "/account/messages", label: "Messages" },
  { href: "/account/settings", label: "Account Settings" },
];

export default function AccountTabs({
  unreadMessageCount = 0,
}: {
  // Real unread-conversation count (internal/message), server-fetched by
  // account/layout.tsx — same badge AccountMenu shows next to "Messages",
  // surfaced again here since this subnav is what's actually visible while
  // browsing the rest of the account section.
  unreadMessageCount?: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-brand-border bg-white px-10 sm:px-12 lg:px-14">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              active
                ? "border-brand-gold text-brand-navy"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            {tab.href === "/account/messages" && unreadMessageCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-urgent px-1 text-[10px] font-bold text-white">
                {unreadMessageCount > 9 ? "9+" : unreadMessageCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
