import Link from "next/link";
import Image from "next/image";
import { Search, User } from "lucide-react";
import TopBar from "./TopBar";
import CategoryNav from "./CategoryNav";
import AccountMenu from "./AccountMenu";
import NotificationBell from "./NotificationBell";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { getListingCounts, getMe, getMyNotifications, getMyThreads } from "@/lib/api";
import { getCurrentSession } from "@/lib/session";
import { paramStr, type SearchParams } from "@/lib/search-params";

export default async function Header({
  searchParams = {},
  sticky = false,
  variant = "full",
}: {
  searchParams?: SearchParams;
  // The header (top bar, search, and category nav) scrolls away normally
  // everywhere by default, per product decision — it should never pin to
  // the top and follow the user down the page. Pass sticky explicitly on
  // the rare page that wants the old pinned behavior.
  sticky?: boolean;
  // "logo-only" strips everything down to just the clickable logo — no
  // top bar, search, category nav, or account/notification controls.
  // Used by focused single-task flows (the Sell wizard) where the full
  // nav is pure distraction and the vertical space is better spent on the
  // form itself. Skips every session/API fetch below entirely, not just
  // hiding their output, since none of it is needed to render a logo.
  variant?: "full" | "logo-only";
} = {}) {
  if (variant === "logo-only") {
    return (
      <header className={`bg-white shadow-sm ${sticky ? "sticky top-0 z-40" : ""}`}>
        <div className="flex items-center px-10 py-0.5 sm:px-12 lg:px-14">
          <Link href="/" className="flex shrink-0 items-center gap-1">
            <Image
              src="/logo-v3.png"
              alt="AuctionHous"
              width={80}
              height={80}
              priority
              unoptimized
              className="h-[80px] w-[80px]"
            />
            <span className="text-2xl font-bold tracking-tight text-brand-navy">
              AuctionHous <span className="text-brand-gold">TCG</span>
            </span>
          </Link>
        </div>
      </header>
    );
  }

  const { session, user } = isSupabaseConfigured()
    ? await getCurrentSession()
    : { session: null, user: null };
  // getMe, getListingCounts, getMyNotifications, and getMyThreads don't
  // depend on each other — running them in parallel instead of
  // sequentially is what actually made this page (and everywhere else
  // Header renders, i.e. every page) noticeably faster. username only
  // lives in public.users (the Go API), not in Supabase's own
  // user_metadata — a Go API outage degrades to fullName/email in
  // AccountMenu (and an empty bell/message badge) rather than breaking the
  // header entirely, same reasoning for all four .catch()es below.
  const [me, counts, notifications, messages] = await Promise.all([
    session ? getMe(session.access_token).catch(() => null) : Promise.resolve(null),
    getListingCounts().catch(() => ({}) as Record<string, number>),
    session
      ? getMyNotifications(session.access_token).catch(() => ({ notifications: [], unreadCount: 0 }))
      : Promise.resolve({ notifications: [], unreadCount: 0 }),
    session
      ? getMyThreads(session.access_token).catch(() => ({ threads: [], unreadCount: 0 }))
      : Promise.resolve({ threads: [], unreadCount: 0 }),
  ]);
  const activeQuery = paramStr(searchParams, "q");
  // Every other active filter gets carried forward as a hidden input when
  // searching, so searching doesn't silently drop the game/price/condition/
  // etc. filters already applied (CLAUDE.md §6.14/§6.15).
  const carryForwardKeys = Object.keys(searchParams).filter((k) => k !== "q");

  return (
    <header className={`bg-white shadow-sm ${sticky ? "sticky top-0 z-40" : ""}`}>
      <TopBar tier={me?.tier ?? null} />
      <div className="flex items-center gap-3 py-0.5 pl-3 pr-10 sm:gap-4 sm:pl-4 sm:pr-12 lg:pl-5 lg:pr-14">
        <Link href="/" className="flex shrink-0 items-center gap-1">
          <Image
            src="/logo-v3.png"
            alt="AuctionHous"
            width={80}
            height={80}
            priority
            unoptimized
            className="h-[80px] w-[80px]"
          />
          <span className="hidden text-2xl font-bold tracking-tight text-brand-navy sm:inline">
            AuctionHous <span className="text-brand-gold">TCG</span>
          </span>
        </Link>

        <form action="/" method="GET" className="hidden flex-1 md:flex" role="search">
          {carryForwardKeys.map((key) => {
            const v = paramStr(searchParams, key);
            return v ? <input key={key} type="hidden" name={key} value={v} /> : null;
          })}
          <div className="flex w-full overflow-hidden rounded-full border border-brand-border focus-within:border-brand-navy">
            <input
              type="search"
              name="q"
              defaultValue={activeQuery}
              placeholder="Search Pokémon, MTG, graded slabs..."
              className="w-full px-4 py-2 text-sm outline-none"
            />
            <button
              type="submit"
              aria-label="Search"
              className="flex items-center gap-1.5 bg-brand-navy px-4 text-sm font-medium text-white transition-colors hover:bg-brand-navy-light"
            >
              <Search size={16} />
            </button>
          </div>
        </form>

        <nav className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {user ? (
            <>
              <NotificationBell
                initialNotifications={notifications.notifications}
                initialUnreadCount={notifications.unreadCount}
              />
              <AccountMenu
                email={user.email ?? "?"}
                username={me?.username ?? null}
                fullName={user.user_metadata?.full_name ?? user.user_metadata?.name ?? null}
                avatarUrl={user.user_metadata?.avatar_url ?? user.user_metadata?.picture}
                unreadMessageCount={messages.unreadCount}
              />
            </>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface"
            >
              <User size={17} />
              <span className="hidden lg:inline">Sign in</span>
            </Link>
          )}
          <Link
            href="/sell"
            className="ml-1 shrink-0 rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light"
          >
            Sell
          </Link>
        </nav>
      </div>

      <form action="/" method="GET" className="px-10 pb-3 md:hidden" role="search">
        {carryForwardKeys.map((key) => {
          const v = paramStr(searchParams, key);
          return v ? <input key={key} type="hidden" name={key} value={v} /> : null;
        })}
        <div className="flex w-full overflow-hidden rounded-full border border-brand-border">
          <input
            type="search"
            name="q"
            defaultValue={activeQuery}
            placeholder="Search listings..."
            className="w-full px-4 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            aria-label="Search"
            className="flex items-center bg-brand-navy px-4 text-white"
          >
            <Search size={16} />
          </button>
        </div>
      </form>

      <CategoryNav searchParams={searchParams} counts={counts} />
    </header>
  );
}
