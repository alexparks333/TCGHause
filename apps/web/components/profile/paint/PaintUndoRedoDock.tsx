"use client";

import { Redo2, Undo2 } from "lucide-react";
import { type PaintEngine } from "./usePaintEngine";

// Floating undo/redo controls pinned to the bottom of the viewport while a
// paint tool is armed — the same fixed-bubble visual language as
// ProfileEditor's WidgetTrashTarget (navy circle, backdrop blur,
// inset-x-0 bottom-8 z-50), so undoing a stroke has an equally reachable
// control without hunting for the small icon buttons in the palette panel
// — which can be dragged elsewhere or scrolled past while the canvas
// itself, potentially much taller than the viewport, is what's actually in
// front of you.
//
// Never visible at the same time as the widget trash target: that one only
// appears during a sticker/widget drag, and both StickerBoard and the
// widget grid go pointer-events-none while a paint tool is armed, so a
// drag can't be in progress here — the two docks share the same screen
// real estate without ever needing to coexist.
export default function PaintUndoRedoDock({ engine, visible }: { engine: PaintEngine; visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex items-center justify-center gap-4">
      <button
        type="button"
        onClick={engine.undo}
        disabled={!engine.canUndo}
        aria-label="Undo"
        title="Undo"
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/15 bg-brand-navy/95 text-white shadow-2xl backdrop-blur transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100"
      >
        <Undo2 size={22} />
      </button>
      <button
        type="button"
        onClick={engine.redo}
        disabled={!engine.canRedo}
        aria-label="Redo"
        title="Redo"
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/15 bg-brand-navy/95 text-white shadow-2xl backdrop-blur transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100"
      >
        <Redo2 size={22} />
      </button>
    </div>
  );
}
