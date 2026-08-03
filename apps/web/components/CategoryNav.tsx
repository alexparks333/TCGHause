import Link from "next/link";
import { GAMES } from "@/lib/types";
import { paramStr, hrefWithParams, type SearchParams } from "@/lib/search-params";

// Plain links to `/?game=...`, not a client-side filter — clicking a bubble
// always lands on the homepage with that game applied, from any page. No
// "use client" needed: the active state is just a server-side string
// comparison against searchParams. Every other active filter (search,
// sold, price range, etc.) is carried forward via hrefWithParams, so
// clicking a game bubble refines the current view instead of resetting it.
export default function CategoryNav({
  searchParams,
  counts,
}: {
  searchParams: SearchParams;
  counts?: Record<string, number>;
}) {
  const activeGame = paramStr(searchParams, "game");

  return (
    <div className="border-t border-brand-border bg-white">
      <div className="flex gap-2 overflow-x-auto px-10 py-2.5 sm:px-12 lg:px-14">
        <Link
          href="/"
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
            !activeGame
              ? "bg-brand-navy text-white"
              : "bg-brand-surface text-gray-700 hover:bg-gray-200"
          }`}
        >
          All Categories
        </Link>
        {GAMES.map((game) => (
          <Link
            key={game}
            href={hrefWithParams(searchParams, { game })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              activeGame === game
                ? "bg-brand-navy text-white"
                : "bg-brand-surface text-gray-700 hover:bg-gray-200"
            }`}
          >
            {game}
            <span className={activeGame === game ? "text-white/70" : "text-gray-500"}>
              {" "}
              ({counts?.[game] ?? 0})
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
