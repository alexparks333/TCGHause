"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { paramStr, paramNum, paramBool, hrefWithParams, type SearchParams } from "@/lib/search-params";
import DualRangeSlider from "./filters/DualRangeSlider";
import ConditionSlider from "./filters/ConditionSlider";

const PRICE_MIN_CENTS = 0;
const PRICE_MAX_CENTS = 100_000; // $1,000 — a practical cap for v1, not a hard product limit
const TIME_LEFT_MAX_HOURS = 168; // 7 days — the longest real auction length (CLAUDE.md §6.1)

// The left-hand filter panel — reflects the game bubble (CategoryNav) and
// the search box (Header) as removable chips, and is itself a real
// <form action="/" method="GET"> for everything else (sold, Buy It Now,
// price, condition, time left) — CLAUDE.md §6.14/§6.15. Collapses
// left-to-right into a slim icon rail rather than a vertical accordion —
// that needs real client state (a width transition, not just show/hide),
// so this is a "use client" component now; the filtering itself is still
// 100% URL-driven, same as the rest of the page.
export default function FilterSidebar({ searchParams }: { searchParams: SearchParams }) {
  const [open, setOpen] = useState(false);

  const activeGame = paramStr(searchParams, "game");
  const activeQuery = paramStr(searchParams, "q");
  const sold = paramBool(searchParams, "sold");
  const fixedOnly = paramBool(searchParams, "fixedOnly");
  const conditionMin = paramStr(searchParams, "conditionMin");
  const priceMin = paramNum(searchParams, "priceMin") ?? PRICE_MIN_CENTS;
  const priceMax = paramNum(searchParams, "priceMax") ?? PRICE_MAX_CENTS;
  const timeLeftMin = paramNum(searchParams, "timeLeftMin") ?? 0;
  const timeLeftMax = paramNum(searchParams, "timeLeftMax") ?? TIME_LEFT_MAX_HOURS;

  const hasAnyFilter =
    Boolean(activeGame) ||
    Boolean(activeQuery) ||
    sold ||
    fixedOnly ||
    Boolean(conditionMin) ||
    priceMin !== PRICE_MIN_CENTS ||
    priceMax !== PRICE_MAX_CENTS ||
    timeLeftMin !== 0 ||
    timeLeftMax !== TIME_LEFT_MAX_HOURS;

  return (
    <aside
      className={`shrink-0 self-start overflow-hidden rounded-xl border border-brand-border bg-white transition-[width] duration-300 ease-in-out ${
        open ? "w-full sm:w-56" : "w-12"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Collapse filters" : "Expand filters"}
        className="relative flex w-full items-center justify-between px-3 py-4"
      >
        {open ? (
          <>
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              Filters
              {hasAnyFilter && (
                <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" aria-label="Filters active" />
              )}
            </span>
            <ChevronLeft size={16} className="shrink-0 text-gray-500" />
          </>
        ) : (
          <>
            <ChevronRight size={16} className="mx-auto shrink-0 text-gray-500" />
            {hasAnyFilter && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand-gold" aria-label="Filters active" />
            )}
          </>
        )}
      </button>

      {open && (
        <div className="w-full min-w-56 px-4 pb-4 sm:min-w-[13rem]">
        {hasAnyFilter && (
          <Link href="/" className="text-xs font-medium text-brand-navy hover:underline">
            Clear all
          </Link>
        )}

        {(activeGame || activeQuery) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeGame && (
              <Link
                href={hrefWithParams(searchParams, { game: undefined })}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-navy-light"
              >
                {activeGame}
                <X size={12} />
              </Link>
            )}
            {activeQuery && (
              <Link
                href={hrefWithParams(searchParams, { q: undefined })}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-navy px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-navy-light"
              >
                &quot;{activeQuery}&quot;
                <X size={12} />
              </Link>
            )}
          </div>
        )}

        <form action="/" method="GET" className="mt-4 flex flex-col gap-5">
          {/* This form doesn't control game/q — mirror them so submitting
              it doesn't drop whatever CategoryNav/the search box set. */}
          {activeGame && <input type="hidden" name="game" value={activeGame} />}
          {activeQuery && <input type="hidden" name="q" value={activeQuery} />}

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="sold"
              value="true"
              defaultChecked={sold}
              className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
            />
            Sold
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="fixedOnly"
              value="true"
              defaultChecked={fixedOnly}
              className="h-4 w-4 rounded border-gray-300 accent-brand-navy"
            />
            Buy It Now only
          </label>

          <DualRangeSlider
            label="Price"
            nameMin="priceMin"
            nameMax="priceMax"
            min={PRICE_MIN_CENTS}
            max={PRICE_MAX_CENTS}
            step={100}
            defaultMin={priceMin}
            defaultMax={priceMax}
            unit="cents"
          />

          <ConditionSlider name="conditionMin" defaultValue={conditionMin} />

          <DualRangeSlider
            label="Time Left"
            nameMin="timeLeftMin"
            nameMax="timeLeftMax"
            min={0}
            max={TIME_LEFT_MAX_HOURS}
            step={1}
            defaultMin={timeLeftMin}
            defaultMax={timeLeftMax}
            unit="hours"
          />

          <button
            type="submit"
            className="rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light"
          >
            Apply Filters
          </button>
        </form>
        </div>
      )}
    </aside>
  );
}
