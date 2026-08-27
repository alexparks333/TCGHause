"use client";

import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import {
  Brush,
  Eraser,
  Feather,
  MousePointer2,
  PaintBucket,
  Pen,
  Pipette,
  Redo2,
  SprayCan,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  PAINT_MAX_BRUSH,
  PAINT_MAX_SPREAD,
  PAINT_MIN_BRUSH,
  PAINT_MIN_SPREAD,
  type PaintTool,
} from "./constants";
import { type PaintEngine } from "./usePaintEngine";

const TOOLS: { tool: PaintTool; label: string; icon: typeof Pen }[] = [
  { tool: "arrange", label: "Arrange (move stickers & widgets)", icon: MousePointer2 },
  { tool: "pen", label: "Pen", icon: Pen },
  { tool: "marker", label: "Paint Brush", icon: Brush },
  { tool: "calligraphy", label: "Calligraphy", icon: Feather },
  { tool: "spray", label: "Spray can", icon: SprayCan },
  { tool: "fill", label: "Fill", icon: PaintBucket },
  { tool: "eyedropper", label: "Eyedropper", icon: Pipette },
  { tool: "eraser", label: "Eraser", icon: Eraser },
];

const isValidHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

// The Background tab's paint toolset — replaces the old "coming soon"
// chip. Pure controls over the shared PaintEngine (which ProfileEditor
// owns); recent colors are session-only by design, like the undo stack.
export default function PaintToolbar({
  engine,
  recentColors,
  onPickRecent,
}: {
  engine: PaintEngine;
  recentColors: string[];
  onPickRecent: (hex: string) => void;
}) {
  // The hex text field needs its own draft state so a half-typed value
  // ("#b8") doesn't get clobbered by the picker echoing the last valid
  // color back; null = not focused, mirror engine.color.
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
        <Brush size={11} /> Paint the canvas
      </p>

      <div className="grid grid-cols-4 gap-1.5">
        {TOOLS.map(({ tool, label, icon: Icon }) => (
          <button
            key={tool}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={engine.tool === tool}
            onClick={() => engine.setTool(tool)}
            className={`flex aspect-square items-center justify-center rounded-lg border transition-all ${
              engine.tool === tool
                ? "border-brand-gold bg-brand-gold/10 text-brand-navy shadow-sm"
                : "border-brand-border text-gray-400 hover:border-brand-gold/40 hover:text-gray-600"
            }`}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[11px] text-gray-500">
        <span className="w-8 shrink-0">Size</span>
        <input
          type="range"
          min={PAINT_MIN_BRUSH}
          max={PAINT_MAX_BRUSH}
          value={engine.size}
          onChange={(e) => engine.setSize(Number(e.target.value))}
          className="flex-1 accent-brand-gold"
        />
        <span className="w-6 text-right tabular-nums text-gray-400">{engine.size}</span>
      </label>

      {/* Spray-only: how far dots scatter from the pointer, independent
          of Size (which drives dot size here, same as it drives stroke
          width for every other tool) — see PAINT_DEFAULT_SPREAD's doc
          comment for why these used to be one number and why that made a
          bigger brush read as a solid blob instead of an airy spray. */}
      {engine.tool === "spray" && (
        <label className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="w-8 shrink-0">Spread</span>
          <input
            type="range"
            min={PAINT_MIN_SPREAD}
            max={PAINT_MAX_SPREAD}
            value={engine.spread}
            onChange={(e) => engine.setSpread(Number(e.target.value))}
            className="flex-1 accent-brand-gold"
          />
          <span className="w-6 text-right tabular-nums text-gray-400">{engine.spread}</span>
        </label>
      )}

      <div className="profile-paint-color-picker">
        <HexColorPicker color={engine.color} onChange={engine.setColor} />
      </div>

      <div className="flex items-center gap-2">
        <span
          className="h-6 w-6 shrink-0 rounded-full border border-black/10 shadow-inner"
          style={{ backgroundColor: engine.color }}
        />
        <input
          type="text"
          value={hexDraft ?? engine.color}
          onFocus={() => setHexDraft(engine.color)}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setHexDraft(v);
            if (isValidHex(v)) engine.setColor(v.toLowerCase());
          }}
          onBlur={() => setHexDraft(null)}
          spellCheck={false}
          className="w-24 rounded-lg border border-brand-border px-2 py-1 font-mono text-xs text-gray-700"
          aria-label="Hex color"
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={engine.undo}
            disabled={!engine.canUndo}
            title="Undo"
            aria-label="Undo"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand-border text-gray-500 transition-colors hover:text-gray-800 disabled:opacity-30"
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            onClick={engine.redo}
            disabled={!engine.canRedo}
            title="Redo"
            aria-label="Redo"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand-border text-gray-500 transition-colors hover:text-gray-800 disabled:opacity-30"
          >
            <Redo2 size={14} />
          </button>
        </div>
      </div>

      {recentColors.length > 0 && (
        <div className="flex items-center gap-1.5">
          {recentColors.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              aria-label={`Use ${hex}`}
              onClick={() => onPickRecent(hex)}
              className={`h-5 w-5 rounded-full border shadow-sm transition-transform hover:scale-110 ${
                hex === engine.color ? "border-brand-navy ring-1 ring-brand-navy/30" : "border-black/10"
              }`}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      )}

      {engine.tool !== "arrange" && (
        <p className="rounded-xl border border-dashed border-brand-border p-2.5 text-[11px] leading-relaxed text-gray-400">
          Painting mode — stickers and widgets are locked. Pick the arrow tool to move them again.
        </p>
      )}

      {/* Wipes the whole bitmap — reversible the same way any other stroke
          is (the Undo button right above, or Cancel before Save), so this
          is a plain click, no confirmation dialog, consistent with every
          other destructive control on this canvas (sticker/widget remove). */}
      <button
        type="button"
        onClick={engine.clearCanvas}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-urgent/30 py-2 text-xs font-semibold text-brand-urgent transition-colors hover:border-brand-urgent hover:bg-brand-urgent/10"
      >
        <Trash2 size={13} /> Clear Canvas
      </button>
    </div>
  );
}
