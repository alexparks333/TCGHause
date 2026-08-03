"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account/buying", label: "Buying" },
  { href: "/account/watchlist", label: "Watchlist" },
  { href: "/account/selling", label: "Selling" },
  { href: "/account/bids-offers", label: "Bids/Offers" },
  { href: "/account/sold-history", label: "Sold History" },
  { href: "/account/buy-history", label: "Buy History" },
  { href: "/account/messages", label: "Messages" },
  { href: "/account/settings", label: "Account Settings" },
];

export default function AccountTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-brand-border bg-white px-10 sm:px-12 lg:px-14">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              active
                ? "border-brand-gold text-brand-navy"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
