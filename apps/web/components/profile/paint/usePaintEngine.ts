"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ProfileCanvas, type ProfileSticker } from "@/lib/api";
import {
  PAINT_DEFAULT_BRUSH,
  PAINT_DEFAULT_COLOR,
  PAINT_DEFAULT_SPREAD,
  PAINT_DESIGN_WIDTH,
  PAINT_MAX_HEIGHT,
  PAINT_UNDO_LIMIT,
  type PaintTool,
} from "./constants";
import {
  drawBrushSegment,
  drawCalligraphySegment,
  drawPenSegment,
  dirtyRectToRegion,
  emptyDirtyRect,
  floodFill,
  growDirtyRect,
  makeBrushBristles,
  pickColor,
  sprayBurst,
  spraySegment,
  type BrushBristles,
  type DirtyRect,
  type StrokePoint,
} from "./tools";

// One undoable action. `region`/`before` restore the bitmap pixels the
// action touched (region-based — full-bitmap snapshots at, say, 2880×2000×4
// ≈ 23MB each are untenable for a 15-deep stack); `after` is captured
// lazily the first time the entry is actually undone, for redo. The
// optional callbacks exist for sticker stamping: undoing a stamp must also
// restore the floating sticker to ProfileEditor's array, and redoing it
// must remove it again — pixel restore alone would strand the sticker.
interface UndoEntry {
  region: { x: number; y: number; w: number; h: number };
  before: ImageData;
  after: ImageData | null;
  onUndo?: () => void;
  onRedo?: () => void;
}

// Everything bitmap: sizing/growth, stroke input, tool dispatch, undo/redo,
// save/cancel baselines, sticker rasterization, PNG export. Rendering and
// pointer-event wiring live in PaintLayer; toolbar state (which tool/color/
// size) lives here so the toolbar and the canvas can't disagree.
export function usePaintEngine({
  saved,
  editable,
  containerRef,
  onColorPicked,
  onColorUsed,
}: {
  // The last-saved canvas descriptor (from the server), or null if never
  // painted. Loaded into the bitmap once per edit session.
  saved: ProfileCanvas | null;
  editable: boolean;
  // ProfileEditor's canvasRef — the overflow-hidden container whose rect
  // is the single source of truth for CSS<->bitmap coordinate mapping
  // (same rect sticker placement already uses).
  containerRef: React.RefObject<HTMLDivElement | null>;
  // Fired when the eyedropper picks a color, so the toolbar can also push
  // it into recent colors / switch back to the previous tool.
  onColorPicked?: (hex: string) => void;
  // Fired when a color is actually laid down on the canvas (stroke
  // committed / fill applied) — recent colors track paint that happened,
  // not every wheel-drag value passed through on the way to it.
  onColorUsed?: (hex: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<PaintTool>("arrange");
  const [color, setColor] = useState(PAINT_DEFAULT_COLOR);
  const [size, setSize] = useState(PAINT_DEFAULT_BRUSH);
  // Spray-only: how far dots scatter from the pointer, independent of
  // `size` (which drives individual dot size for spray, same as it drives
  // stroke width for every other tool) — see PAINT_DEFAULT_SPREAD's doc
  // comment for why these used to be conflated into one number.
  const [spread, setSpread] = useState(PAINT_DEFAULT_SPREAD);
  const [paintDirty, setPaintDirty] = useState(false);
  // Pointer position while hovering the canvas (armed or not), in CSS
  // pixels relative to the container's top-left — what BrushCursor renders
  // the size/shape preview at. cssPerBitmapPx converts a brush size
  // (bitmap px) to an on-screen diameter: captured alongside the position
  // so the preview stays correct through a window resize without a second
  // rect read at render time. null whenever the pointer isn't over the
  // canvas (or hasn't moved onto it yet this session).
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number; cssPerBitmapPx: number } | null>(null);
  // Bitmap height lives in state so the <canvas> element's height
  // attribute re-renders when the page grows. Width is always
  // PAINT_DESIGN_WIDTH.
  const [bitmapHeight, setBitmapHeight] = useState(0);

  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  // Bumped whenever the stacks change, purely so canUndo/canRedo re-render.
  const [undoVersion, setUndoVersion] = useState(0);

  // The last-saved pixels, for Cancel — an ImageBitmap (GPU-friendly,
  // cheap to hold) captured at load and refreshed by markSaved().
  const savedSnapshotRef = useRef<ImageBitmap | null>(null);
  // Guards the initial load so a re-render mid-session never re-clobbers
  // in-progress painting with the saved PNG.
  const loadedRef = useRef(false);

  // Active-stroke state (refs, not state — this updates per pointer event).
  const strokeRef = useRef<{
    pointerId: number;
    last: StrokePoint;
    dirty: DirtyRect;
    // Full-bitmap copy made at pointerdown, discarded at pointerup — the
    // source for the undo entry's `before` region. One live copy at a
    // time, never stacked.
    preStroke: HTMLCanvasElement;
  } | null>(null);
  const sprayRef = useRef<{ point: StrokePoint; raf: number } | null>(null);
  // The current stroke's fixed bristle arrangement — generated once at
  // pointerdown (like dipping a brush in paint) and reused for every
  // segment of that stroke; see makeBrushBristles' doc comment for why it
  // can't be regenerated per segment.
  const brushBristlesRef = useRef<BrushBristles | null>(null);

  const ctx = useCallback(() => canvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null, []);

  // ---- coordinate mapping ----------------------------------------------

  const toBitmap = useCallback(
    (clientX: number, clientY: number): StrokePoint | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return null;
      const scale = PAINT_DESIGN_WIDTH / rect.width;
      return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale, pressure: 0.5 };
    },
    [containerRef],
  );

  // Shared by handlePointerDown/Move so both keep the hover cursor's
  // position and scale in sync with the container's CURRENT rect (a window
  // resize between events shouldn't leave the preview sized for the old
  // width) without a duplicate rect read at render time.
  const updateHoverFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      setHoverPos({ x: clientX - rect.left, y: clientY - rect.top, cssPerBitmapPx: rect.width / PAINT_DESIGN_WIDTH });
    },
    [containerRef],
  );

  const handlePointerLeave = useCallback(() => {
    setHoverPos(null);
  }, []);

  // ---- sizing / growth --------------------------------------------------

  // Grow-only: never shrink, never rescale. Copy the old pixels to a temp
  // canvas, enlarge (which clears), draw them back 1:1 at the top. Art
  // below the current fold stays in the bitmap — the container's
  // overflow-hidden clips it visually, and re-adding widgets reveals it.
  const growTo = useCallback((neededHeight: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const target = Math.min(PAINT_MAX_HEIGHT, Math.ceil(neededHeight));
    if (target <= canvas.height) return;
    const temp = document.createElement("canvas");
    temp.width = canvas.width;
    temp.height = canvas.height;
    if (canvas.height > 0) temp.getContext("2d")!.drawImage(canvas, 0, 0);
    canvas.height = target;
    const c = ctx();
    if (c && temp.height > 0) c.drawImage(temp, 0, 0);
    setBitmapHeight(target);
  }, [ctx]);

  const ensureHeight = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = PAINT_DESIGN_WIDTH / rect.width;
    growTo(rect.height * scale);
  }, [containerRef, growTo]);

  // ---- initial load -----------------------------------------------------

  // On entering edit mode: size the bitmap to the container, then draw the
  // saved PNG (if any) into it. crossOrigin MUST be set before src or the
  // canvas is tainted and every getImageData/toBlob afterward throws —
  // killing eyedropper, fill, undo, and save. Supabase's public storage
  // endpoint serves Access-Control-Allow-Origin: *.
  useEffect(() => {
    if (!editable) {
      // Leaving edit mode resets the session guard so re-entering reloads
      // fresh (state was either saved or cancelled on the way out).
      loadedRef.current = false;
      setHoverPos(null);
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;

    setTool("arrange"); // every edit session starts in arrange mode

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = PAINT_DESIGN_WIDTH;
    canvas.height = 0;
    setBitmapHeight(0);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoVersion((v) => v + 1);
    setPaintDirty(false);
    ensureHeight();

    if (saved?.url) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = ctx();
        if (!c) return;
        // Saved art may have been authored at a different PAINT_DESIGN_WIDTH
        // than today's (a resolution bump like this one, or any future
        // one) — scale it to fill the CURRENT design width exactly rather
        // than drawImage-ing at its old natural size, which would only
        // fill part of a wider canvas (leaving the rest blank) and put old
        // and new brushwork at two different effective resolutions.
        const scaledHeight = Math.max(1, Math.round(img.naturalHeight * (canvas.width / img.naturalWidth)));
        growTo(Math.max(scaledHeight, canvas.height));
        c.drawImage(img, 0, 0, canvas.width, scaledHeight);
        // Snapshot the CANVAS post-scale (not the raw img at its old
        // size), so Cancel restores what's actually on screen.
        createImageBitmap(canvas).then((bm) => {
          savedSnapshotRef.current?.close();
          savedSnapshotRef.current = bm;
        });
      };
      img.src = saved.url;
    } else {
      savedSnapshotRef.current?.close();
      savedSnapshotRef.current = null;
    }
  }, [editable, saved, ctx, ensureHeight, growTo]);

  // ---- undo/redo --------------------------------------------------------

  const commitAction = useCallback(
    (dirty: DirtyRect, preStroke: HTMLCanvasElement | null, hooks?: { onUndo?: () => void; onRedo?: () => void }) => {
      const canvas = canvasRef.current;
      const c = ctx();
      if (!canvas || !c) return;
      const region = dirtyRectToRegion(dirty, canvas.width, canvas.height);
      if (!region) return;
      let before: ImageData;
      if (preStroke) {
        const pc = preStroke.getContext("2d", { willReadFrequently: true })!;
        before = pc.getImageData(region.x, region.y, region.w, region.h);
      } else {
        // Fill/stamp callers snapshot before drawing instead.
        before = c.getImageData(region.x, region.y, region.w, region.h);
      }
      undoStackRef.current.push({ region, before, after: null, ...hooks });
      if (undoStackRef.current.length > PAINT_UNDO_LIMIT) undoStackRef.current.shift();
      redoStackRef.current = [];
      setUndoVersion((v) => v + 1);
      setPaintDirty(true);
    },
    [ctx],
  );

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    const c = ctx();
    if (!entry || !c) return;
    if (!entry.after) {
      entry.after = c.getImageData(entry.region.x, entry.region.y, entry.region.w, entry.region.h);
    }
    c.putImageData(entry.before, entry.region.x, entry.region.y);
    entry.onUndo?.();
    redoStackRef.current.push(entry);
    setUndoVersion((v) => v + 1);
    setPaintDirty(true);
  }, [ctx]);

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    const c = ctx();
    if (!entry || !c || !entry.after) return;
    c.putImageData(entry.after, entry.region.x, entry.region.y);
    entry.onRedo?.();
    undoStackRef.current.push(entry);
    setUndoVersion((v) => v + 1);
    setPaintDirty(true);
  }, [ctx]);

  // ---- stroke input -----------------------------------------------------

  const normalizePressure = (p: number) => (p === 0 ? 0.5 : p);

  const drawSegment = useCallback(
    (from: StrokePoint, to: StrokePoint, dirty: DirtyRect) => {
      const c = ctx();
      if (!c) return;
      switch (tool) {
        case "pen":
          drawPenSegment(c, from, to, color, size, dirty);
          break;
        case "eraser":
          c.save();
          c.globalCompositeOperation = "destination-out";
          drawPenSegment(c, from, to, "#000", size, dirty);
          c.restore();
          break;
        case "marker": {
          // Lazily initialized as a fallback only — the real init is in
          // handlePointerDown, before the very first segment of a stroke,
          // so the whole stroke shares one bristle arrangement. This just
          // keeps a stray call (there shouldn't be one) from throwing.
          if (!brushBristlesRef.current) brushBristlesRef.current = makeBrushBristles(size, to.pressure);
          drawBrushSegment(c, from, to, color, size, dirty, brushBristlesRef.current);
          break;
        }
        case "calligraphy":
          drawCalligraphySegment(c, from, to, color, size, dirty);
          break;
        case "spray":
          // Path coverage (see spraySegment's own comment); the rAF loop
          // below layers "held in place" buildup on top of this. `size`
          // drives dot size, `spread` drives scatter radius — kept as two
          // independent values, see PAINT_DEFAULT_SPREAD's doc comment.
          spraySegment(c, from, to, color, size, spread, dirty);
          break;
        default:
          break;
      }
    },
    [ctx, tool, color, size, spread],
  );

  const stopSpray = useCallback(() => {
    if (sprayRef.current) {
      cancelAnimationFrame(sprayRef.current.raf);
      sprayRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      updateHoverFromClient(e.clientX, e.clientY);
      if (tool === "arrange") return;
      const canvas = canvasRef.current;
      const c = ctx();
      const point = toBitmap(e.clientX, e.clientY);
      if (!canvas || !c || !point) return;
      point.pressure = normalizePressure(e.pressure);

      if (tool === "eyedropper") {
        const hex = pickColor(c, point.x, point.y, canvas.width, canvas.height);
        if (hex) {
          setColor(hex);
          onColorPicked?.(hex);
        }
        return;
      }

      if (tool === "fill") {
        const dirty = emptyDirtyRect();
        // Snapshot-before-draw for fill: floodFill mutates via putImageData,
        // so copy the bitmap first and hand commitAction that copy.
        const pre = document.createElement("canvas");
        pre.width = canvas.width;
        pre.height = canvas.height;
        pre.getContext("2d")!.drawImage(canvas, 0, 0);
        const changed = floodFill(c, canvas.width, canvas.height, point.x, point.y, color, dirty);
        if (changed) {
          commitAction(dirty, pre);
          onColorUsed?.(color);
        }
        return;
      }

      // Best-effort: capture keeps the stroke alive when the pointer exits
      // the canvas, but an inactive pointer id (synthetic events, some
      // assistive tech) throws NotFoundError — a stroke without capture
      // still works, so never let that abort the pointerdown.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const pre = document.createElement("canvas");
      pre.width = canvas.width;
      pre.height = canvas.height;
      pre.getContext("2d")!.drawImage(canvas, 0, 0);
      const dirty = emptyDirtyRect();
      strokeRef.current = { pointerId: e.pointerId, last: point, dirty, preStroke: pre };

      // Fresh bristle arrangement for this stroke — like dipping the brush
      // in paint again. Must happen before the first drawSegment call
      // below so every segment of this stroke (including the initial dab)
      // shares it; see makeBrushBristles' doc comment.
      if (tool === "marker") brushBristlesRef.current = makeBrushBristles(size, point.pressure);

      // A click with no movement still leaves a mark — spray included
      // (spraySegment's zero-length case is a single burst at the point).
      drawSegment(point, point, dirty);

      if (tool === "spray") {
        // Layered on top of spraySegment's path coverage (called from
        // drawSegment above and again in handlePointerMove): this rAF loop
        // keeps spraying at wherever the pointer currently is even while
        // it's completely still, which a pure path-interpolated burst
        // never would — the classic "hold to build up a cloud" airbrush
        // behavior.
        const loop = () => {
          const s = sprayRef.current;
          const stroke = strokeRef.current;
          if (!s || !stroke) return;
          sprayBurst(c, s.point, color, size, spread, stroke.dirty);
          s.raf = requestAnimationFrame(loop);
        };
        sprayRef.current = { point, raf: requestAnimationFrame(loop) };
      }
    },
    [tool, ctx, toBitmap, color, size, spread, commitAction, drawSegment, onColorPicked, updateHoverFromClient],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Tracked on every move, not just while a stroke is active — this is
      // what lets the brush-size/shape preview follow the cursor BEFORE
      // the first click, not only mid-stroke.
      updateHoverFromClient(e.clientX, e.clientY);
      const stroke = strokeRef.current;
      if (!stroke || e.pointerId !== stroke.pointerId) return;
      const native = e.nativeEvent;
      const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
      const source = events.length > 0 ? events : [native];
      for (const ev of source) {
        const point = toBitmap(ev.clientX, ev.clientY);
        if (!point) continue;
        point.pressure = normalizePressure(ev.pressure);
        drawSegment(stroke.last, point, stroke.dirty);
        // Keeps the hold-still rAF loop (handlePointerDown) targeting the
        // pointer's latest real position — separate from spraySegment's
        // own path coverage, which drawSegment just did above.
        if (tool === "spray" && sprayRef.current) sprayRef.current.point = point;
        stroke.last = point;
      }
    },
    [toBitmap, tool, drawSegment, updateHoverFromClient],
  );

  const handlePointerUp = useCallback(() => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    stopSpray();
    strokeRef.current = null;
    commitAction(stroke.dirty, stroke.preStroke);
    if (tool !== "eraser") onColorUsed?.(color);
  }, [commitAction, stopSpray, tool, color, onColorUsed]);

  // Losing the pointer mid-stroke (tab switch, palm rejection) commits
  // whatever was drawn rather than orphaning an un-undoable half-stroke.
  const handlePointerCancel = handlePointerUp;

  // ---- sticker stamping -------------------------------------------------

  // Rasterize a floating sticker into the bitmap at its exact rendered
  // position/rotation/scale, mirroring StickerBoard's CSS transform
  // (translate(-50%,-50%) rotate scale). Returns false if anything wasn't
  // ready (image failed to decode, no container rect) so the caller keeps
  // the sticker floating instead of losing it.
  const stampSticker = useCallback(
    async (
      sticker: ProfileSticker,
      src: string,
      stickerCssSize: number,
      hooks: { onUndo: () => void; onRedo: () => void },
    ): Promise<boolean> => {
      const canvas = canvasRef.current;
      const c = ctx();
      const container = containerRef.current;
      if (!canvas || !c || !container) return false;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return false;

      const img = new Image();
      img.src = src;
      try {
        await img.decode();
      } catch {
        return false;
      }

      const k = PAINT_DESIGN_WIDTH / rect.width;
      const cx = (sticker.xPct / 100) * PAINT_DESIGN_WIDTH;
      const cy = sticker.yPx * k;
      const draw = stickerCssSize * sticker.scale * k;

      // Snapshot the affected region BEFORE drawing (commitAction's
      // no-preStroke branch reads post-draw otherwise). The dirty rect is
      // the rotated sticker's bounding circle — simpler than exact
      // rotated-rect math and only slightly larger.
      const radius = (draw * Math.SQRT2) / 2 + 2;
      const dirty = emptyDirtyRect();
      growDirtyRect(dirty, cx, cy, radius);
      const region = dirtyRectToRegion(dirty, canvas.width, canvas.height);
      if (!region) return false;
      const before = c.getImageData(region.x, region.y, region.w, region.h);

      c.save();
      c.translate(cx, cy);
      c.rotate((sticker.rotationDeg * Math.PI) / 180);
      c.drawImage(img, -draw / 2, -draw / 2, draw, draw);
      c.restore();

      undoStackRef.current.push({ region, before, after: null, ...hooks });
      if (undoStackRef.current.length > PAINT_UNDO_LIMIT) undoStackRef.current.shift();
      redoStackRef.current = [];
      setUndoVersion((v) => v + 1);
      setPaintDirty(true);
      return true;
    },
    [ctx, containerRef],
  );

  // ---- save / cancel ----------------------------------------------------

  const exportBlob = useCallback(async (): Promise<{ blob: Blob; width: number; height: number } | null> => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.height === 0) return null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return { blob, width: canvas.width, height: canvas.height };
  }, []);

  // Whether every pixel is transparent — a fully-erased canvas saves as
  // "no canvas" (setMyCanvas(null)) rather than uploading an empty PNG.
  const isBlank = useCallback((): boolean => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c || canvas.height === 0) return true;
    const data = c.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  }, [ctx]);

  // Wipes the entire bitmap to transparent — one big, undoable action (same
  // preStroke-snapshot + commitAction path the fill tool uses, just with a
  // dirty rect spanning the whole canvas instead of a flood-filled region),
  // not a separate irreversible code path. No-ops on an already-blank
  // canvas so an idle click doesn't push a pointless entry onto the undo
  // stack.
  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c || canvas.height === 0 || isBlank()) return;
    const pre = document.createElement("canvas");
    pre.width = canvas.width;
    pre.height = canvas.height;
    pre.getContext("2d")!.drawImage(canvas, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    commitAction({ minX: 0, minY: 0, maxX: canvas.width, maxY: canvas.height }, pre);
  }, [ctx, isBlank, commitAction]);

  // The just-saved pixels become the new Cancel baseline; the undo history
  // resets ("saved is the new zero"), matching how stickers/widgets re-seed
  // their saved arrays from the server response.
  const markSaved = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.height > 0) {
      const bm = await createImageBitmap(canvas);
      savedSnapshotRef.current?.close();
      savedSnapshotRef.current = bm;
    } else {
      savedSnapshotRef.current?.close();
      savedSnapshotRef.current = null;
    }
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoVersion((v) => v + 1);
    setPaintDirty(false);
  }, []);

  // Cancel: wipe and redraw the last-saved snapshot (or leave empty if
  // never saved). Bitmap height is kept — growth is content-driven and
  // still valid.
  const restoreSaved = useCallback(() => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (savedSnapshotRef.current) c.drawImage(savedSnapshotRef.current, 0, 0);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoVersion((v) => v + 1);
    setPaintDirty(false);
  }, [ctx]);

  void undoVersion; // read so linters see the state is consumed via canUndo/canRedo below

  return {
    canvasRef,
    bitmapHeight,
    tool,
    setTool,
    color,
    setColor,
    size,
    setSize,
    spread,
    setSpread,
    paintDirty,
    hoverPos,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    undo,
    redo,
    ensureHeight,
    stampSticker,
    exportBlob,
    isBlank,
    clearCanvas,
    markSaved,
    restoreSaved,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
  };
}

export type PaintEngine = ReturnType<typeof usePaintEngine>;
