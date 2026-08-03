import type { Game } from "@/lib/types";

const GRADIENTS: Record<Game, string> = {
  Pokémon: "from-yellow-400 via-amber-500 to-blue-700",
  "Magic: The Gathering": "from-slate-800 via-purple-900 to-slate-950",
  "Yu-Gi-Oh!": "from-purple-700 via-fuchsia-800 to-amber-600",
  "Disney Lorcana": "from-teal-400 via-cyan-600 to-indigo-700",
  Riftbound: "from-red-600 via-rose-800 to-slate-950",
  "Sports Cards": "from-emerald-700 via-slate-800 to-slate-950",
};

export default function CardArt({
  game,
  label,
}: {
  game: Game;
  label: string;
}) {
  return (
    <div
      className={`relative flex h-full w-full items-center justify-center bg-gradient-to-br ${GRADIENTS[game]}`}
    >
      <div className="absolute inset-3 rounded-md border border-white/25" />
      <span className="px-4 text-center text-sm font-semibold uppercase tracking-wide text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]">
        {label}
      </span>
    </div>
  );
}
