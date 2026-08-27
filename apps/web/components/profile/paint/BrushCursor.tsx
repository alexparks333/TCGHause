"use client";

import { PAINT_TOOLS_WITHOUT_SIZE_CURSOR, type PaintTool } from "./constants";

// A live preview of what the armed tool is about to lay down, following
// the pointer BEFORE the first click — Photoshop/MS-Paint-style. Renders
// as a sibling of the paint <canvas> (see PaintLayer), positioned in the
// same CSS coordinate space (relative to the canvas container), so it
// tracks the exact spot a stroke would start.
//
// Diameter is derived from the brush size (bitmap px) via
// hoverPos.cssPerBitmapPx — the same conversion factor
// usePaintEngine.toBitmap uses in reverse — so the ring always matches the
// real stroke width the tool will produce, not an approximation.
export default function BrushCursor({
  tool,
  size,
  spread,
  color,
  hoverPos,
}: {
  tool: PaintTool;
  size: number;
  // Spray's scatter radius — a separate value from `size` (which drives
  // spray's individual dot size, same as it drives every other tool's
  // stroke width). Only read for the "spray" branch below.
  spread: number;
  color: string;
  hoverPos: { x: number; y: number; cssPerBitmapPx: number } | null;
}) {
  if (!hoverPos || PAINT_TOOLS_WITHOUT_SIZE_CURSOR.has(tool)) return null;

  // mix-blend-mode: difference keeps the ring visible over any background
  // color (light or dark canvas paint) without needing to sample what's
  // underneath — a plain solid-color border would disappear over a
  // same-colored stroke.
  const base = "pointer-events-none absolute z-[6] mix-blend-difference";

  if (tool === "calligraphy") {
    // The nib itself: a short bar at the same fixed ~45° angle
    // tools.ts's NIB_ANGLE draws with, length = brush size. This is the
    // one tool where "size" doesn't map to a round stroke, so a circle
    // here would misrepresent what's about to be drawn.
    const length = Math.max(6, size * hoverPos.cssPerBitmapPx);
    const thickness = Math.max(2, length * 0.22);
    return (
      <div
        className={`${base} rounded-full border border-white/80`}
        style={{
          left: hoverPos.x,
          top: hoverPos.y,
          width: length,
          height: thickness,
          backgroundColor: `${color}66`,
          transform: "translate(-50%, -50%) rotate(-45deg)",
        }}
      />
    );
  }

  if (tool === "spray") {
    // Sized from `spread` (the scatter radius), not `size` (which drives
    // spray's individual dot size) — this ring previews how WIDE the
    // cloud will land, not how big any one fleck is. Dashed, not solid —
    // hints at the scattered-dot texture rather than a hard stroke edge.
    const spreadDiameter = Math.max(6, spread * 2 * hoverPos.cssPerBitmapPx);
    return (
      <div
        className={`${base} rounded-full border border-dashed border-white/80`}
        style={{
          left: hoverPos.x,
          top: hoverPos.y,
          width: spreadDiameter,
          height: spreadDiameter,
          transform: "translate(-50%, -50%)",
        }}
      />
    );
  }

  const diameter = Math.max(6, size * hoverPos.cssPerBitmapPx);
  const style = {
    left: hoverPos.x,
    top: hoverPos.y,
    width: diameter,
    height: diameter,
    transform: "translate(-50%, -50%)",
  };

  if (tool === "marker") {
    // The paint brush's footprint — a faint fill hints at the translucent
    // buildup, though the real stroke is textured bristle streaks (see
    // makeBrushBristles in tools.ts), not this uniform circle; a full
    // per-bristle preview isn't worth the complexity for a cursor ring.
    return (
      <div
        className={`${base} rounded-full border border-white/70`}
        style={{ ...style, backgroundColor: `${color}33` }}
      />
    );
  }

  // pen / eraser: a plain hard-edged ring — exactly the stroke's footprint.
  return <div className={`${base} rounded-full border border-white/80`} style={style} />;
}
