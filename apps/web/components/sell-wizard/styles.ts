// Shared field styling for the Sell wizard. Deliberately darker than the
// site's default --color-brand-border (#e5e7eb) — that's fine for card
// grids sitting on the page background, but on a white wizard panel it was
// too close to invisible. border-gray-300 + shadow-sm gives fields a real
// outline instead of relying on contrast alone.
export const inputClass =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition-colors focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";
export const labelClass = "flex flex-col gap-1.5 text-sm font-medium text-gray-700";
