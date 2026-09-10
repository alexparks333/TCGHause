"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inputClass, labelClass } from "./styles";
import type { CatalogCard } from "@/lib/types";
import type { UpdateField } from "../SellWizard";
import { searchCatalogCards, searchCatalogCardsAllGames } from "@/lib/api";

// Only games TCG Haven's catalog actually covers
// (apps/api/internal/cardcatalog/games.go) — the only options worth
// offering in the game filter below, since every other game always
// resolves to zero results.
const CATALOG_SUPPORTED_GAMES = ["Pokémon", "Disney Lorcana", "Riftbound"];

// Sits above the Sell wizard's step box (not inside Step1Details' form) so
// it reads as "find your card first," separate from the hand-fillable
// fields below. Closing on outside-click (not onBlur) is deliberate — an
// onBlur-based close fights with clicking a result (blur fires before the
// click registers) and was the cause of "can't search again" after a
// selection: the dropdown could end up stuck closed with no clean way to
// reopen it. Click-outside avoids that whole race.
//
// Searches across every catalog-backed game at once by default
// (searchCatalogCardsAllGames, same endpoint the Favorite Card widget
// picker uses) rather than being scoped to whatever the Game dropdown
// below currently says — the wizard defaults that dropdown to "Pokémon",
// so a per-game-scoped search silently only ever matched Pokémon cards
// unless a seller happened to change the dropdown first. `gameFilter`
// below is a separate, opt-in narrowing a seller can apply to this search
// box specifically, not tied to the wizard's own Game field. Picking a
// result always sets the wizard's Game field from the result itself
// (card.game, stamped by the API per-result), regardless of which filter
// was used to find it.
export default function CardSearch({ update }: { update: UpdateField }) {
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState("");
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CatalogCard | null>(null);
  const requestId = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shouldSearch = query.trim().length >= 2;
    const id = ++requestId.current;
    if (!shouldSearch) {
      setLoading(false);
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const search = gameFilter
        ? searchCatalogCards(gameFilter, query)
        : searchCatalogCardsAllGames(query);
      search
        .then((cards) => {
          if (id === requestId.current) {
            setResults(cards);
            setOpen(true);
            setLoading(false);
          }
        })
        .catch(() => {
          if (id === requestId.current) {
            setResults([]);
            setLoading(false);
          }
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, gameFilter]);

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
    update("title", card.name);
    update("game", card.game);
    update("setName", card.setName);
    update("cardNumber", card.number);
    update("rarity", card.rarity);
    setSelectedCard(card);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function clearSelection() {
    setSelectedCard(null);
  }

  return (
    <div ref={wrapperRef} className="relative rounded-2xl border border-gray-300 bg-white p-4 shadow-sm">
      {selectedCard ? (
        <div className="flex items-center gap-4">
          {selectedCard.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selectedCard.imageUrl}
              alt={selectedCard.name}
              className="h-28 w-auto rounded-lg border border-gray-200 shadow-sm"
            />
          )}
          <div className="flex-1">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Selected card
            </span>
            <p className="font-medium text-gray-900">{selectedCard.name}</p>
            <p className="text-xs text-gray-500">
              {selectedCard.game} · {selectedCard.setName} · #{selectedCard.number}
              {selectedCard.rarity ? ` · ${selectedCard.rarity}` : ""}
            </p>
            <button
              type="button"
              onClick={clearSelection}
              className="mt-2 text-xs font-medium text-brand-navy hover:underline"
            >
              Search a different card
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">Search for your card</span>
            <select
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 shadow-sm outline-none transition-colors focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
            >
              <option value="">All games</option>
              {CATALOG_SUPPORTED_GAMES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="relative">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (results.length > 0) setOpen(true);
              }}
              className={`${inputClass} w-full pr-9`}
              placeholder="Start typing a card name to autofill the details below..."
            />
            {loading && (
              <Loader2
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400"
              />
            )}
          </div>
        </div>
      )}
      {open && (loading || results.length > 0) && (
        <div className="absolute z-10 mt-1 max-h-[28rem] w-[calc(100%-2rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {loading && results.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              Loading cards...
            </div>
          )}
          {results.length > 0 && (
            <ul>
              {results.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    onClick={() => selectCard(card)}
                    className="flex w-full items-center gap-4 px-3 py-3 text-left text-sm hover:bg-brand-surface"
                  >
                    {card.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.imageUrl} alt="" className="h-24 w-auto rounded" />
                    )}
                    <span>
                      <span className="font-medium text-gray-900">{card.name}</span>
                      <span className="block text-xs text-gray-500">
                        {card.game} · {card.setName} · #{card.number}
                        {card.rarity ? ` · ${card.rarity}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
