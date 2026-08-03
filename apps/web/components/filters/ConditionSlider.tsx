"use client";

import { useState } from "react";

// Mirrors apps/api/internal/catalog.ConditionOrder exactly — worst to
// best, so the slider's rightmost position is "Near Mint or better".
const CONDITIONS = ["Damaged", "Heavily Played", "Moderately Played", "Lightly Played", "Near Mint"];

// A single native range input can only submit a number, but the backend's
// conditionMin filter (internal/listing.ListFilters) expects one of the
// condition strings above. The visible <input type="range"> is nameless
// (never submitted); a hidden input mirrors its index to the real string
// value on every change, so the form still submits with no JS required
// beyond that mirroring. Index 0 ("Damaged") submits as "" (no filter) —
// Damaged is the worst tier, so "Damaged or better" already means
// everything, making an explicit filter for it meaningless.
export default function ConditionSlider({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue?: string;
}) {
  const initialIndex = defaultValue ? CONDITIONS.indexOf(defaultValue) : 0;
  const [index, setIndex] = useState(initialIndex < 0 ? 0 : initialIndex);

  return (
    <div>
      <div className="flex items-center justify-between text-xs font-medium text-gray-700">
        <span>Condition</span>
        <span className="text-gray-500">{index === 0 ? "Any" : `${CONDITIONS[index]}+`}</span>
      </div>
      <input
        type="range"
        min={0}
        max={CONDITIONS.length - 1}
        step={1}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        aria-label="Minimum condition"
        className="mt-2 w-full accent-brand-navy"
      />
      <input type="hidden" name={name} value={index === 0 ? "" : CONDITIONS[index]} />
    </div>
  );
}
