// The drawing primitives behind usePaintEngine — every function here takes
// bitmap-space coordinates (already mapped through PAINT_DESIGN_WIDTH /
// container width by the caller) and draws straight into the bitmap's 2D
// context. Nothing here touches React state; the engine owns stroke
// lifecycle, undo bookkeeping, and coordinate mapping.

export interface StrokePoint {
  x: number;
  y: number;
  // PointerEvent.pressure, normalized by the engine: mice report 0.5 per
  // spec, some devices report 0 — the engine maps 0 -> 0.5 so only a real
  // pressure-reporting pen (Wacom/Pencil) actually varies width.
  pressure: number;
}

// A stroke's dirty bounding box, grown as points arrive — what region-based
// undo snapshots instead of the whole bitmap.
export interface DirtyRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyDirtyRect(): DirtyRect {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function growDirtyRect(rect: DirtyRect, x: number, y: number, radius: number) {
  rect.minX = Math.min(rect.minX, x - radius);
  rect.minY = Math.min(rect.minY, y - radius);
  rect.maxX = Math.max(rect.maxX, x + radius);
  rect.maxY = Math.max(rect.maxY, y + radius);
}

// Clamp a dirty rect to the bitmap and convert to integer x/y/w/h for
// getImageData/putImageData. Null when the stroke never actually touched
// the bitmap (e.g. an entirely out-of-bounds drag).
export function dirtyRectToRegion(
  rect: DirtyRect,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  const x = Math.max(0, Math.floor(rect.minX));
  const y = Math.max(0, Math.floor(rect.minY));
  const maxX = Math.min(width, Math.ceil(rect.maxX));
  const maxY = Math.min(height, Math.ceil(rect.maxY));
  if (maxX <= x || maxY <= y) return null;
  return { x, y, w: maxX - x, h: maxY - y };
}

function pressureWidth(size: number, pressure: number): number {
  // 0.5 pressure (a mouse) = the slider's exact size; a light pen stroke
  // thins toward 20%, a hard press thickens toward 180%.
  return Math.max(1, size * (0.2 + pressure * 1.6));
}

// Hard round pen — each coalesced segment is its own round-capped stroke so
// pressure can vary width mid-gesture. Also the eraser's geometry: the
// engine sets globalCompositeOperation = "destination-out" around it.
export function drawPenSegment(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  color: string,
  size: number,
  dirty: DirtyRect,
) {
  const width = pressureWidth(size, to.pressure);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  growDirtyRect(dirty, from.x, from.y, width);
  growDirtyRect(dirty, to.x, to.y, width);
}

// Paint brush — simulates a cluster of individual bristles instead of one
// flat translucent band. A single uniform-alpha stroke (what this used to
// be, and what the eraser/pen still are) is exactly right for a highlighter
// or a hard pen, but it's the opposite of what a paintbrush actually looks
// like: real bristles each carry a slightly different amount of paint, so
// a brushstroke is streaky and textured, not one flat, perfectly even
// color band — verified during testing that a perfectly uniform stroke
// (alpha stddev of 0 across dozens of samples) reads as a marker, not a
// brush, no matter how clean it is.
//
// BrushBristles is the fixed set of individual bristle offsets/alphas/
// widths for ONE stroke, generated once at pointerdown (makeBrushBristles)
// and reused for every segment of that stroke — like dipping a real brush
// in paint once and drawing until you lift it. Recomputing random bristles
// on every segment instead would look like flickering noise rather than
// coherent streaks running the length of the stroke.
export interface BrushBristles {
  // Each bristle's fixed lateral offset from the stroke's centerline
  // (bitmap px), spread roughly evenly across the brush footprint with a
  // little jitter so they don't look mechanically evenly spaced.
  offsets: number[];
  // Each bristle's own opacity multiplier — some bristles carry more
  // paint than others, which is what makes the combined stroke look
  // streaky/textured instead of flat.
  alphas: number[];
  // Each bristle's own thickness multiplier, same reasoning.
  widths: number[];
}

const BRISTLE_COUNT = 9;

export function makeBrushBristles(size: number, pressure: number): BrushBristles {
  const radius = pressureWidth(size, pressure) / 2;
  const offsets: number[] = [];
  const alphas: number[] = [];
  const widths: number[] = [];
  for (let i = 0; i < BRISTLE_COUNT; i++) {
    const t = (i / (BRISTLE_COUNT - 1)) * 2 - 1; // spread -1..1 across the footprint
    offsets.push(t * radius * 0.85 + (Math.random() - 0.5) * radius * 0.25);
    alphas.push(0.3 + Math.random() * 0.45);
    widths.push(0.35 + Math.random() * 0.55);
  }
  return { offsets, alphas, widths };
}

export function drawBrushSegment(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  color: string,
  size: number,
  dirty: DirtyRect,
  bristles: BrushBristles,
) {
  const radius = pressureWidth(size, to.pressure);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const isDab = len < 0.01;
  // Perpendicular unit vector to the segment's own direction — bristle
  // offsets are applied along this, so they stay perpendicular to
  // whichever way the stroke is currently heading (a real brush's
  // bristles fan out sideways to the direction of travel, not to some
  // fixed stroke-start direction), recomputed fresh per segment so the
  // fan follows a curving stroke.
  const nx = isDab ? 1 : -dy / len;
  const ny = isDab ? 0 : dx / len;

  const prevAlpha = ctx.globalAlpha;
  ctx.lineCap = "butt"; // same double-compositing fix as the old marker code
  ctx.lineJoin = "round";
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  for (let i = 0; i < bristles.offsets.length; i++) {
    const off = bristles.offsets[i];
    const bristleWidth = Math.max(0.6, radius * bristles.widths[i] * 0.4);
    ctx.globalAlpha = bristles.alphas[i];
    if (isDab) {
      ctx.beginPath();
      ctx.arc(to.x + nx * off, to.y + ny * off, bristleWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.lineWidth = bristleWidth;
      ctx.beginPath();
      ctx.moveTo(from.x + nx * off, from.y + ny * off);
      ctx.lineTo(to.x + nx * off, to.y + ny * off);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = prevAlpha;
  growDirtyRect(dirty, from.x, from.y, radius + 4);
  growDirtyRect(dirty, to.x, to.y, radius + 4);
}

// Calligraphy — a fixed 45° nib of length `size`: for each segment, fill
// the quadrilateral joining the nib's endpoints at `from` and at `to`.
// Width varies with TWO independent factors, both real nib-pen behaviors
// layered together: direction (thin moving parallel to the nib, full width
// perpendicular to it — purely geometric, from the fixed angle) and speed
// (thick where the hand lingers, tapering on fast strokes — see
// CALLIGRAPHY_SPEED_TAPER below). Direction alone produces a static shape
// for any single straight gesture; speed is what makes a single stroke
// flow from thick to thin along its own length, the way real calligraphy
// actually looks, rather than a rigid, uniformly-angled parallelogram.
const NIB_ANGLE = Math.PI / 4;
const NIB_DX = Math.cos(NIB_ANGLE);
const NIB_DY = -Math.sin(NIB_ANGLE);

// How much a fast segment thins the nib relative to a slow one — 1 means
// "no effect", 0 would mean a fast segment vanishes entirely. 0.45 gives a
// clearly visible taper without ever pinching a fast stroke to nothing.
const CALLIGRAPHY_SPEED_TAPER = 0.45;
// Per-segment travel distance (bitmap px) considered "fast enough" to hit
// the full taper — beyond this, more speed doesn't thin the nib further.
const CALLIGRAPHY_SPEED_REFERENCE_PX = 55;

export function drawCalligraphySegment(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  color: string,
  size: number,
  dirty: DirtyRect,
) {
  // A fixed nib angle alone only varies width with stroke DIRECTION —
  // with a mouse (pressure pinned at 0.5, so pressureWidth alone is
  // constant for the whole gesture) that makes every stroke a single
  // static parallelogram: no thick-to-thin flow along its own length,
  // which is what reads as "just an angled oval" rather than a living
  // calligraphy line. Real nib pens (and hand pressure generally) lay
  // down more ink where the hand lingers and less where it's moving
  // fast; per-segment travel distance is a direct, timestamp-free proxy
  // for that speed (coalesced pointer samples arrive at a roughly
  // constant rate, so a longer segment between two samples means the
  // pointer covered more ground in the same span of real time). Slow
  // segments keep the full nib width; fast ones taper toward
  // CALLIGRAPHY_SPEED_TAPER of it — layered on top of the direction-based
  // width the fixed nib angle already produces, not a replacement for it.
  const travelPx = Math.hypot(to.x - from.x, to.y - from.y);
  const speedFactor = 1 - Math.min(1, travelPx / CALLIGRAPHY_SPEED_REFERENCE_PX) * (1 - CALLIGRAPHY_SPEED_TAPER);
  const half = (pressureWidth(size, to.pressure) / 2) * speedFactor;
  const ox = NIB_DX * half;
  const oy = NIB_DY * half;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(from.x - ox, from.y - oy);
  ctx.lineTo(from.x + ox, from.y + oy);
  ctx.lineTo(to.x + ox, to.y + oy);
  ctx.lineTo(to.x - ox, to.y - oy);
  ctx.closePath();
  ctx.fill();
  // A hairline stroke on the same path bridges the anti-aliasing seam
  // between this quad and the next one (two independently-rasterized fills
  // sharing an exact edge can otherwise leave a faint 1px gap along it) —
  // an earlier version filled a round circle at the joint instead, which
  // covered the seam but rounded off exactly the sharp, angular corners
  // that make a flat-nib pen look like calligraphy rather than a fat felt
  // tip; this keeps the geometry genuinely angular. 1px regardless of nib
  // size — this is only ever meant to be an invisible seam-filler, not a
  // visible outline.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  growDirtyRect(dirty, from.x, from.y, half + 1);
  growDirtyRect(dirty, to.x, to.y, half + 1);
}

// Spray can — one burst of randomly scattered dots within radius `spread`
// of the point, uniform-in-disk (sqrt on the radial draw, so dots don't
// bunch toward the center). The engine's rAF loop calls this repeatedly at
// the pointer's CURRENT position while it's held, so paint keeps
// accumulating even when the cursor is completely still — the classic
// airbrush "hold to build up a cloud" behavior. See spraySegment below for
// the other half: bursts along a moving path, not just at one point.
//
// `size` (dot size) and `spread` (scatter radius) are deliberately
// separate parameters, not one number doing both jobs. An earlier version
// derived both the scatter radius AND the individual dot size from the
// same brush-size value, with dot COUNT also scaling with that same
// radius squared — three effects compounding off one slider meant turning
// it up didn't just make a wider cloud, it also made bigger dots packed
// far more densely, which read as a solid marker-like blob instead of an
// airy spray. Direct product feedback: "its all so dense now... super
// dense like a thick marker compared to the old one."
export function sprayBurst(
  ctx: CanvasRenderingContext2D,
  at: StrokePoint,
  color: string,
  size: number,
  spread: number,
  dirty: DirtyRect,
) {
  const dotBaseR = pressureWidth(size, at.pressure) * 0.12;
  // Dot COUNT scales only mildly (linearly) with spread, not spread² —
  // widening the cloud spreads roughly the same rate of paint over more
  // area (like moving a real can further from the surface, which covers
  // more area but thins out, not "more paint out of the nozzle"), rather
  // than packing in proportionally more dots to keep density constant as
  // the area grows. Capped so a maxed-out spread can't tank the frame
  // rate — the hold-still rAF loop calls this up to ~60 times/sec.
  const dots = Math.max(3, Math.min(70, Math.round(spread / 3)));
  const prevAlpha = ctx.globalAlpha;
  ctx.fillStyle = color;
  for (let i = 0; i < dots; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const x = at.x + Math.cos(angle) * r;
    const y = at.y + Math.sin(angle) * r;
    const dotR = Math.max(0.5, dotBaseR * (0.6 + Math.random() * 0.9));
    ctx.globalAlpha = 0.45 + Math.random() * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = prevAlpha;
  // Margin covers the largest dot that can land right at the spread
  // radius's edge, not just the spread radius itself — otherwise a big
  // dot size could get clipped out of the undo region near the burst's
  // outer edge.
  growDirtyRect(dirty, at.x, at.y, spread + dotBaseR * 1.5 + 5);
}

// Bursts along the whole from->to segment, not just at `to` — the missing
// half of the spray can. Before this existed, moving the pointer only ever
// updated WHERE the rAF hold-still loop's next burst would land; the loop
// runs at display refresh rate (~60/sec) independent of how far the
// pointer actually traveled between frames, so a fast swipe left visible
// gaps of untouched canvas between each frame's burst — a spray can that
// only sprayed where your hand currently was, not along the path it swept
// through, which is the opposite of how a real one behaves. Interpolating
// a burst roughly every 4 bitmap px of travel keeps coverage continuous
// regardless of swipe speed; the rAF loop still separately handles "held
// in place" buildup on top of this.
export function spraySegment(
  ctx: CanvasRenderingContext2D,
  from: StrokePoint,
  to: StrokePoint,
  color: string,
  size: number,
  spread: number,
  dirty: DirtyRect,
) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(dist / 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    sprayBurst(
      ctx,
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, pressure: to.pressure },
      color,
      size,
      spread,
      dirty,
    );
  }
}

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// Scanline flood fill with a small per-channel tolerance (anti-aliased
// stroke edges are never exactly one color, so an exact-match fill leaves
// halos). Operates on the whole bitmap's ImageData; returns the filled
// region's bounding box (for undo) or null if the seed color already
// matches the fill color (no-op).
const FILL_TOLERANCE = 32;

export function floodFill(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  startX: number,
  startY: number,
  hexColor: string,
  dirty: DirtyRect,
): boolean {
  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return false;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const idx = (sy * width + sx) * 4;
  const target = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
  const fill = hexToRgba(hexColor);
  if (
    Math.abs(target[0] - fill[0]) <= 2 &&
    Math.abs(target[1] - fill[1]) <= 2 &&
    Math.abs(target[2] - fill[2]) <= 2 &&
    target[3] === 255
  ) {
    return false;
  }

  const matches = (i: number) =>
    Math.abs(data[i] - target[0]) <= FILL_TOLERANCE &&
    Math.abs(data[i + 1] - target[1]) <= FILL_TOLERANCE &&
    Math.abs(data[i + 2] - target[2]) <= FILL_TOLERANCE &&
    Math.abs(data[i + 3] - target[3]) <= FILL_TOLERANCE;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    // Walk left to the span's start.
    while (x >= 0 && !visited[y * width + x] && matches((y * width + x) * 4)) x--;
    x++;
    let spanUp = false;
    let spanDown = false;
    // Fill rightward, seeding the rows above/below at span transitions.
    while (x < width && !visited[y * width + x] && matches((y * width + x) * 4)) {
      const p = y * width + x;
      visited[p] = 1;
      const i = p * 4;
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
      growDirtyRect(dirty, x, y, 1);
      if (y > 0) {
        const upMatch = !visited[(y - 1) * width + x] && matches(((y - 1) * width + x) * 4);
        if (upMatch && !spanUp) {
          stack.push(x, y - 1);
          spanUp = true;
        } else if (!upMatch) {
          spanUp = false;
        }
      }
      if (y < height - 1) {
        const downMatch = !visited[(y + 1) * width + x] && matches(((y + 1) * width + x) * 4);
        if (downMatch && !spanDown) {
          stack.push(x, y + 1);
          spanDown = true;
        } else if (!downMatch) {
          spanDown = false;
        }
      }
      x++;
    }
  }

  ctx.putImageData(image, 0, 0);
  return true;
}

// Eyedropper — the pixel's hex color, or null for a fully transparent
// pixel (nothing painted there; picking "transparent" as a pen color
// would just be confusing).
export function pickColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): string | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return null;
  const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
  if (a === 0) return null;
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
