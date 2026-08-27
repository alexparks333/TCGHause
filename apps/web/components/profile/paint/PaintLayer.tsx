"use client";

import { useEffect } from "react";
import { type ProfileCanvas } from "@/lib/api";
import BrushCursor from "./BrushCursor";
import { PAINT_TOOLS_WITHOUT_SIZE_CURSOR } from "./constants";
import { type PaintEngine } from "./usePaintEngine";

// The painting layer of the profile canvas — sits at z-[5], between the
// backdrop (z-0) and the sticker layer (z-10), in BOTH modes, so a sticker
// always renders above the paint (until it's stamped and becomes paint).
//
// Two very different renderings:
//  - View mode / non-owner: the saved artwork as a plain <img> at
//    width:100% — natural aspect ratio reproduces exactly the edit-mode
//    CSS mapping (bitmap width -> container width). No <canvas> element,
//    no JS, for visitors.
//  - Edit mode (owner): the live bitmap <canvas>. It only accepts pointer
//    events while a paint tool is armed — in arrange mode it's inert so
//    stickers (z-10) and widget controls stay interactive above it.
//
// The documented, accepted coordinate caveat (same precedent as stickers'
// yPx): the painting scales proportionally with viewport width in both
// axes, while stickers' yPx offset doesn't scale — everything lines up
// exactly at the width the owner painted at, and drifts vertically
// relative to stickers at other widths.
export default function PaintLayer({
  engine,
  savedCanvas,
  editable,
  paintArmed,
  containerRef,
}: {
  engine: PaintEngine;
  savedCanvas: ProfileCanvas | null;
  editable: boolean;
  paintArmed: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Grow the bitmap whenever the container's rendered size changes —
  // widgets added/removed change height; window resizes change width and
  // therefore the CSS->bitmap scale, which changes the needed pixel
  // height too. Grow-only (see usePaintEngine.growTo).
  useEffect(() => {
    if (!editable) return;
    const container = containerRef.current;
    if (!container) return;
    engine.ensureHeight();
    const observer = new ResizeObserver(() => engine.ensureHeight());
    observer.observe(container);
    return () => observer.disconnect();
  }, [editable, containerRef, engine]);

  if (!editable) {
    if (!savedCanvas) return null;
    return (
      // Plain <img>, deliberately not next/image — the Supabase public URL
      // would need remotePatterns config, and there's exactly one of these
      // per profile at its natural resolution anyway.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={savedCanvas.url}
        alt=""
        className="pointer-events-none absolute left-0 top-0 z-[5] w-full select-none"
      />
    );
  }

  // Fill/eyedropper don't have a stroke-width preview to show (see
  // BrushCursor) — the system crosshair is the whole indicator for them.
  // Every other armed tool hides the system cursor in favor of
  // BrushCursor's own size/shape ring, so there's only ever one indicator
  // on screen, not two disagreeing ones.
  const hasSizeCursor = paintArmed && !PAINT_TOOLS_WITHOUT_SIZE_CURSOR.has(engine.tool);

  return (
    <>
      {/* width/height attributes are managed IMPERATIVELY by
          usePaintEngine (initial sizing + growTo), never as React props —
          React re-applying a dimension attribute clears a canvas's pixels,
          even when the value is unchanged from the DOM's point of view. */}
      <canvas
        ref={engine.canvasRef}
        onPointerDown={engine.handlePointerDown}
        onPointerMove={engine.handlePointerMove}
        onPointerUp={engine.handlePointerUp}
        onPointerCancel={engine.handlePointerCancel}
        onPointerLeave={engine.handlePointerLeave}
        className={`absolute left-0 top-0 z-[5] w-full ${
          paintArmed ? `touch-none ${hasSizeCursor ? "cursor-none" : "cursor-crosshair"}` : "pointer-events-none"
        }`}
        style={{ height: "auto" }}
      />
      {paintArmed && (
        <BrushCursor
          tool={engine.tool}
          size={engine.size}
          spread={engine.spread}
          color={engine.color}
          hoverPos={engine.hoverPos}
        />
      )}
    </>
  );
}
