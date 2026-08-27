"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import { Stamp } from "lucide-react";
import { type ProfileSticker } from "@/lib/api";
import { profileStickerSrc } from "@/lib/types";

// Mirrors apps/api/internal/user.maxStickers exactly.
export const MAX_STICKERS = 12;

// The one real sticker size — what a placed sticker renders at AND what
// the drag preview shows while it's in hand (ProfileEditor's DragOverlay
// uses this same constant), so there's no shrink-on-drop moment. Palette
// chips stay their own small icon size (ProfileEditorPalette.tsx) — that's
// just a swatch to pick a kind from, not a preview of the applied size.
export const STICKER_SIZE = 84;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// The Background layer of the profile canvas (ProfileEditor.tsx) — a fully
// controlled, unbounded sticker layer: it fills whatever size its parent
// gives it (`absolute inset-0`) rather than owning its own bounded box.
// xPct anchors horizontally to the canvas's width; yPx anchors vertically
// as a fixed pixel offset from the canvas's *top*, not a percentage of its
// height — the canvas grows/shrinks from the bottom as widgets come and
// go, and a height-relative Y would otherwise recompute to a different
// pixel position (every sticker visibly sliding) every time that
// happened. Adding/removing/saving stickers all live in the parent
// (ProfileEditor + ProfileEditorPalette) — this component only renders
// the current arrangement and, when editable, lets you drag pieces around
// within it.
export default function StickerBoard({
  stickers,
  onChange,
  editable,
  justPlacedId,
  onStamp,
}: {
  stickers: ProfileSticker[];
  onChange: (stickers: ProfileSticker[]) => void;
  editable: boolean;
  // The sticker that just landed from a drag-drop (ProfileEditor tracks
  // this and clears it once the entrance animation finishes) — plays the
  // iOS-style "pop" once, on the one sticker that actually needs it, not
  // on every sticker every time the arrangement re-renders.
  justPlacedId?: string | null;
  // Bake this sticker into the paint layer (ProfileEditor's handleStamp) —
  // it becomes erasable pixels and leaves this floating layer. Optional so
  // the board renders unchanged wherever painting isn't wired up.
  onStamp?: (id: string) => void;
}) {
  const draggingId = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>, id: string) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingId.current = id;
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingId.current || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const xPct = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
    const yPx = Math.max(0, e.clientY - rect.top);
    const id = draggingId.current;
    onChange(stickers.map((s) => (s.id === id ? { ...s, xPct, yPx } : s)));
  }

  function handlePointerUp() {
    draggingId.current = null;
  }

  function removeSticker(id: string) {
    onChange(stickers.filter((s) => s.id !== id));
  }

  return (
    <div
      ref={boardRef}
      // Always z-10, behind the foreground (z-20), in both edit and view
      // mode — this has to match the final read-only rendering exactly, or
      // a sticker placed "over" a headline while editing would visibly
      // jump behind it the moment you're done editing. Clickability for a
      // sticker sitting under text is solved on the foreground's side
      // instead (ProfileEditor.tsx makes its empty space pointer-events-
      // none while editing, so clicks fall through to whatever's here).
      className={`absolute inset-0 z-10 ${editable ? "touch-none" : "pointer-events-none"}`}
    >
      {stickers.map((s) => (
        <div
          key={s.id}
          style={{
            left: `${s.xPct}%`,
            top: `${s.yPx}px`,
            // Position/rotation/scale live here, on the outer node — kept
            // separate from the entrance-pop animation below so the two
            // transforms don't fight over the same CSS property.
            transform: `translate(-50%, -50%) rotate(${s.rotationDeg}deg) scale(${s.scale})`,
          }}
          onPointerDown={editable ? (e) => handlePointerDown(e, s.id) : undefined}
          onPointerMove={editable ? handlePointerMove : undefined}
          onPointerUp={editable ? handlePointerUp : undefined}
          className={`group absolute ${editable ? "pointer-events-auto cursor-grab active:cursor-grabbing" : ""}`}
        >
          <div className={s.id === justPlacedId ? "animate-sticker-land" : undefined}>
            <Image
              src={profileStickerSrc(s.kind) ?? ""}
              alt=""
              width={STICKER_SIZE}
              height={STICKER_SIZE}
              unoptimized
              draggable={false}
              className={`pointer-events-none select-none drop-shadow-md transition-[filter] ${
                editable ? "group-hover:drop-shadow-[0_10px_20px_rgba(184,134,11,0.4)]" : ""
              }`}
            />
            {editable && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => removeSticker(s.id)}
                className="pointer-events-auto absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs text-gray-500 shadow ring-1 ring-brand-border transition-all hover:scale-110 hover:bg-brand-urgent hover:text-white"
                aria-label="Remove sticker"
              >
                ×
              </button>
            )}
            {editable && onStamp && (
              // Bake into the painting — after this the sticker is pixels
              // (erasable, eyedroppable) and no longer movable. Undoable
              // via the paint undo stack (ProfileEditor wires the hooks).
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onStamp(s.id)}
                className="pointer-events-auto absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-500 shadow ring-1 ring-brand-border transition-all hover:scale-110 hover:bg-brand-navy hover:text-white"
                aria-label="Stamp sticker into the painting"
                title="Stamp into painting (becomes paint — erasable, not movable)"
              >
                <Stamp size={11} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
