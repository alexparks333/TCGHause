"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CatalogCard } from "@/lib/types";
import { searchCatalogCardsAllGames } from "@/lib/api";

// The Favorite Card widget's toolbar picker — search-as-you-type against
// every catalog-backed game at once (searchCatalogCardsAllGames), unlike
// the Sell wizard's CardSearch which only ever searches within one
// already-chosen game. Deliberately a small trigger button that opens a
// floating popover rather than an always-visible input sitting inline in
// the widget's toolbar pill — that pill is a compact, single-line strip
// shared with every other widget type, too narrow to host a real search
// box and its results list without redesigning the whole toolbar around
// this one widget.
export default function FavoriteCardPicker({
  current,
  onSelect,
  onClear,
}: {
  // Only `.name` is ever read here (for the trigger button's label) — kept
  // structural rather than requiring the full CatalogCard shape so a saved
  // FavoriteCardRef (a narrower snapshot, see lib/api.ts) can be passed
  // directly without a cast.
  current: { name: string } | null | undefined;
  onSelect: (card: CatalogCard) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogCard[]>([]);
  const requestId = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const shouldSearch = query.trim().length >= 2;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      if (!shouldSearch) {
        if (id === requestId.current) setResults([]);
        return;
      }
      searchCatalogCardsAllGames(query)
        .then((cards) => {
          if (id === requestId.current) setResults(cards);
        })
        .catch(() => {
          if (id === requestId.current) setResults([]);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Click-outside closes rather than onBlur, for the same reason as
  // CardSearch — onBlur fires before a result's onClick registers, which
  // is what makes a result un-clickable, not just a cosmetic annoyance.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectCard(card: CatalogCard) {
    onSelect(card);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
        className="ml-1 max-w-[9rem] truncate rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-xs text-white hover:bg-white/20"
      >
        {current ? current.name : "Choose a card..."}
      </button>
      {current && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClear}
          className="ml-1 text-white/40 hover:text-red-300"
          aria-label="Clear favorite card"
        >
          <X size={12} />
        </button>
      )}
      {open && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-2 text-gray-900 shadow-xl [color-scheme:light]"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Pokémon, Lorcana, Riftbound..."
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:border-brand-gold focus:outline-none"
          />
          {results.length > 0 ? (
            <ul className="mt-2 max-h-64 overflow-y-auto">
              {results.map((card) => (
                <li key={`${card.game}-${card.id}`}>
                  <button
                    type="button"
                    onClick={() => selectCard(card)}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-brand-surface"
                  >
                    {card.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.imageUrl} alt="" className="h-12 w-auto rounded" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-gray-900">{card.name}</span>
                      <span className="block truncate text-[10px] text-gray-500">
                        {card.game} · {card.setName}
                        {card.number ? ` · #${card.number}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            query.trim().length >= 2 && <p className="mt-2 px-1.5 text-[11px] text-gray-400">No matches.</p>
          )}
        </div>
      )}
    </div>
  );
}
