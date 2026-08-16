"use client";

import { useEffect, useRef, useState } from "react";
import { inputClass, labelClass } from "./styles";
import type { CatalogCard } from "@/lib/types";
import type { UpdateField } from "../SellWizard";
import { searchCatalogCards } from "@/lib/api";

// Only games TCG Haven's catalog actually covers (apps/api/internal/cardcatalog/games.go) —
// MTG, Yu-Gi-Oh!, and Sports Cards get no autofill suggestions.
const CATALOG_SUPPORTED_GAMES = new Set(["Pokémon", "Disney Lorcana", "Riftbound"]);

// Sits above the Sell wizard's step box (not inside Step1Details' form) so
// it reads as "find your card first," separate from the hand-fillable
// fields below. Closing on outside-click (not onBlur) is deliberate — an
// onBlur-based close fights with clicking a result (blur fires before the
// click registers) and was the cause of "can't search again" after a
// selection: the dropdown could end up stuck closed with no clean way to
// reopen it. Click-outside avoids that whole race.
export default function CardSearch({ game, update }: { game: string; update: UpdateField }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [open, setOpen] = useState(false);
  const requestId = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shouldSearch = CATALOG_SUPPORTED_GAMES.has(game) && query.trim().length >= 2;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      if (!shouldSearch) {
        if (id === requestId.current) setResults([]);
        return;
      }
      searchCatalogCards(game, query)
        .then((cards) => {
          if (id === requestId.current) {
            setResults(cards);
            setOpen(true);
          }
        })
        .catch(() => {
          if (id === requestId.current) setResults([]);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [game, query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!CATALOG_SUPPORTED_GAMES.has(game)) return null;

  function selectCard(card: CatalogCard) {
    update("title", card.setName ? `${card.name} - ${card.setName}` : card.name);
    update("setName", card.setName);
    update("cardNumber", card.number);
    update("rarity", card.rarity);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative rounded-2xl border border-gray-300 bg-white p-4 shadow-sm">
      <label className={labelClass}>
        Search for your card
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          className={inputClass}
          placeholder="Start typing a card name to autofill the details below..."
        />
      </label>
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-[28rem] w-[calc(100%-2rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
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
                    {card.setName} · #{card.number}
                    {card.rarity ? ` · ${card.rarity}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
