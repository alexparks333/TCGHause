"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/types";

function formatHours(hours: number): string {
  if (hours <= 0) return "Now";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem === 0 ? `${days}d` : `${days}d ${rem}h`;
}

// A function prop can't cross the server/client boundary (Server Components
// can't serialize a function reference to send to a Client Component) — so
// formatting is picked by this `unit` string instead of a passed-in
// formatter function, and done internally.
type Unit = "cents" | "hours";

function formatValue(unit: Unit, value: number): string {
  return unit === "cents" ? formatPrice(value) : formatHours(value);
}

// Two stacked single-handle range inputs (not an overlapping dual-handle
// widget) — simpler and more reliable than the usual two-thumbs-on-one-
// track CSS hack, at the cost of a little visual polish. Each input keeps
// its own `name` so a plain form GET submission carries both values with
// no JS required for the actual filtering; the live label above is the
// only thing client-side state drives.
export default function DualRangeSlider({
  label,
  nameMin,
  nameMax,
  min,
  max,
  step,
  defaultMin,
  defaultMax,
  unit,
}: {
  label: string;
  nameMin: string;
  nameMax: string;
  min: number;
  max: number;
  step: number;
  defaultMin: number;
  defaultMax: number;
  unit: Unit;
}) {
  const [minVal, setMinVal] = useState(defaultMin);
  const [maxVal, setMaxVal] = useState(defaultMax);

  return (
    <div>
      <div className="flex items-center justify-between text-xs font-medium text-gray-700">
        <span>{label}</span>
        <span className="text-gray-500">
          {formatValue(unit, minVal)} – {formatValue(unit, maxVal)}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <input
          type="range"
          name={nameMin}
          min={min}
          max={max}
          step={step}
          value={minVal}
          onChange={(e) => setMinVal(Math.min(Number(e.target.value), maxVal))}
          aria-label={`Minimum ${label}`}
          className="w-full accent-brand-navy"
        />
        <input
          type="range"
          name={nameMax}
          min={min}
          max={max}
          step={step}
          value={maxVal}
          onChange={(e) => setMaxVal(Math.max(Number(e.target.value), minVal))}
          aria-label={`Maximum ${label}`}
          className="w-full accent-brand-navy"
        />
      </div>
    </div>
  );
}
