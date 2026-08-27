"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, GripVertical, X, LayoutGrid, Trash2 } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  useDndContext,
  useDroppable,
  type CollisionDetection,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import Avatar from "@/components/Avatar";
import StarRating from "@/components/StarRating";
import MessageSellerButton from "@/components/messages/MessageSellerButton";
import StickerBoard, { clamp, MAX_STICKERS, STICKER_SIZE } from "./StickerBoard";
import ProfileEditorPalette from "./ProfileEditorPalette";
import PaintLayer from "./paint/PaintLayer";
import PaintUndoRedoDock from "./paint/PaintUndoRedoDock";
import { usePaintEngine } from "./paint/usePaintEngine";
import { PAINT_RECENT_COLORS_LIMIT } from "./paint/constants";
import { ListingsWidget, FavoriteCardWidget, EmptySpaceWidget, WIDGET_1COL_HEIGHT } from "./WidgetRenderers";
import FavoriteCardPicker from "./FavoriteCardPicker";
import {
  type BuyerStats,
  type Me,
  type PublicUser,
  type ProfileWidget,
  type FavoriteCardRef,
  type ReviewSummary,
  setMyCanvas,
  setMyStickers,
  setMyWidgets,
} from "@/lib/api";
import { uploadProfileCanvas, deleteProfileCanvas } from "@/lib/storage";
import { type Listing, MAX_WIDGETS, WIDGET_CATALOG, profileStickerSrc } from "@/lib/types";

// Backend clamps ProfileSticker.RotationDeg to [-180, 180] — scrolling
// during a drag accumulates way past that, so this folds any value back
// into range right before it's saved (a live in-hand rotation of 900deg
// and one of 180deg should both land the sticker the same way).
function normalizeRotation(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return mod > 180 ? mod - 360 : mod;
}

const ROTATE_SENSITIVITY = 0.35;
const STICKER_LAND_MS = 450;

// Plain closestCenter picks whichever droppable's CENTER POINT is
// numerically nearest the cursor — in a grid mixing a col-span-3 row
// (Listings) with a col-span-1 cell (Favorite Card), that can resolve to
// a widget the cursor isn't even over, because "nearest center" doesn't
// know about the asymmetric footprints. pointerWithin (is the cursor
// literally inside this droppable's rect) is what actually makes the
// stack track "wherever your cursor currently is" — closestCenter is only
// the fallback for the moment the pointer is over a gap between cells.
//
// The trash can is deliberately excluded from that fallback. It's a
// small, fixed-position target near the bottom of the viewport — "nearest
// center, no matter how far away" was resolving `over` to it from
// anywhere the pointer wasn't genuinely within any other droppable's
// bounds (e.g. hovering blank space well above it), which read as the
// trash "randomly" activating and derailing normal placement even though
// the cursor was nowhere near the actual trash bubble. It should only
// ever match via a literal pointer-within-bounds hover.
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  const withoutTrash = args.droppableContainers.filter((c) => c.id !== WIDGET_TRASH_ID);
  return closestCenter({ ...args, droppableContainers: withoutTrash });
};

// SortableWidget hand-rolls its own reflow animation (see the
// useLayoutEffect in that component) instead of using dnd-kit's built-in
// per-item transform/animateLayoutChanges — confirmed via direct browser
// testing (dispatching real pointer events and reading dnd-kit's own live
// inline style) that its FLIP-recovery math, which computes a
// scaleX/scaleY delta by comparing an item's rect before and after an
// index change, produces wildly wrong multipliers in this specific grid:
// Listings (col-span-3) and Favorite Card (col-span-1) differ in
// rendered width by roughly 3x, and in one captured trace, dragging one
// past the other left the OTHER (non-dragged) widget sitting at
// `scaleX(0.32) scaleY(0.18)` — the actual "gets massive"/squashed bug,
// and not limited to the widget being dragged. dnd-kit's own mechanism
// assumes same-size items trading positions (the common sortable-list
// case); it isn't built for a grid this asymmetric. The hand-rolled
// version below only ever compares an item's own rect to its own
// previous rect and only ever applies a translate (never a scale), which
// is both simpler and correct for "this widget's position changed, its
// size didn't."
const WIDGET_REFLOW_MS = 320;
const WIDGET_REFLOW_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const WIDGET_TRASH_ID = "widget-trash";

// Minimum time (ms) between two *different* dragOverIndex values before a
// third change is allowed to flip it back — see commitDragOverIndex in
// ProfileEditor. Confirmed via direct browser testing (logging every real
// reorder-animation trigger during a single, continuous, monotonic
// pointer drag) that reordering a widget moves it — and if the pointer
// happens to be hovering close to the boundary that reorder just crossed,
// the widget's own new position falls back outside the pointer's hover
// zone, which reverts the reorder, which moves the widget back, which
// re-enters the hover zone, which redoes the reorder... a genuine
// feedback loop, not a fluke: one such test logged 24 real
// (non-corrupted, correctly-sized) reflow triggers alternating +136px/
// -136px within a single 25-step drag toward one fixed point. 150ms is
// long enough to absorb that oscillation (each full cycle in the observed
// trace took ~40-50ms) while still being fast enough that a genuine
// direction reversal by the user doesn't read as laggy.
const DRAG_OVER_FLIP_HYSTERESIS_MS = 150;

// How far past a widget's midpoint the cursor has to move, in the
// direction AWAY from whichever side is currently selected, before
// computeInsertIndexFromPointer accepts a flip — a real, position-based
// dead zone, not just the time-based pacing DRAG_OVER_FLIP_HYSTERESIS_MS
// already provides. See that function's own comment for the full why;
// short version: ordinary cursor jitter of a few pixels is completely
// normal and shouldn't be enough to flip an insert-before/after decision
// back and forth. 24px is comfortably larger than typical mouse jitter
// (single-digit pixels) while still being a small enough zone that a
// real, deliberate move across it doesn't feel unresponsive.
const INSERT_ZONE_MARGIN_PX = 24;

// A stable placeholder id for "a new widget is currently hovering over the
// stack" — never persisted, just inserted into the array the stack
// *renders* (see previewWidgets below) so the real widgets already there
// animate out of the way live, the way an iPhone home screen opens a gap
// while you're still holding the app you're moving. Real reordering of
// already-placed widgets doesn't need this trick — see handleDragMove.
const WIDGET_GHOST_ID = "__widget_ghost__";

// The canvas is a 3-column grid (iOS-widget-style: each type declares its
// own footprint rather than every widget being a full-width stacked
// block). Listings is a scrollable row of cards — it needs the full row
// to make sense, so it spans all 3 columns; every other type (Favorite
// Card, Empty Space) is a single cell. Rows themselves aren't capped at a
// fixed number — worth revisiting once there are enough widget types (and
// enough of them placed at once, now that Empty Space can repeat) to
// actually fill a page.
function widgetColSpan(type: string): string {
  return type === "listings" ? "col-span-3" : "col-span-1";
}

// A full-width type (listings) always starts its own row at column 1
// regardless of what's stored — there's nothing else it could share a row
// with, and letting a stray Col value push it to a non-1 start in a
// 3-column grid would make it overflow past the last column and wrap to
// the next row instead of just filling this one. Only a narrower type
// (favorite_card) actually reads its own Col.
function widgetGridColumnStyle(widget: ProfileWidget): CSSProperties {
  if (widget.type === "listings") return {};
  return { gridColumnStart: widget.col + 1 };
}

// Which of the 3 columns the pointer is currently over, given the rect of
// whatever droppable it resolved to (the general stack area, or a specific
// widget it's hovering) — this is what lets a 1-column widget land in any
// of the 3 slots on its row instead of always the first free one.
function computeCol(pointerX: number, rect: { left: number; width: number }): number {
  return clamp(Math.floor(((pointerX - rect.left) / rect.width) * 3), 0, 2);
}

// The floating/ghost preview for a 1-column widget (new from the palette,
// or an already-placed one being repositioned) — a single dashed box sized
// and positioned exactly like the real widget will be once dropped:
// col-span-1, pinned to whichever of the 3 columns the pointer currently
// resolves to via gridColumnStart.
//
// An earlier version ("ThreeSlotRow") showed all 3 columns of the row at
// once — the hovered one highlighted, the other two empty outlines — by
// wrapping itself in col-span-3 to claim the whole row. That was a real,
// reported bug, not just a style choice: forcing col-span-3 meant the
// preview (and the real drop target it was standing in for) ALWAYS
// consumed an entire row for itself, even when the row already had another
// 1-column widget in it with two genuinely free columns — e.g. Favorite
// Card sitting in column 1 with columns 2 and 3 open couldn't receive a
// second widget there at all; every drop got pushed to a brand new row
// instead of sharing the existing one, because the col-span-3 wrapper left
// no room for it to land beside Favorite Card. A plain col-span-1 box
// shares a row with whatever's already there exactly the way the final,
// actually-placed widget does — the preview and the real result now agree.
function ColumnGhost({ col, children }: { col: number; children: ReactNode }) {
  return (
    <div className="animate-canvas-hint-pulse col-span-1" style={{ gridColumnStart: col + 1 }}>
      <div className="h-full rounded-2xl border-2 border-dashed border-brand-gold bg-brand-gold/5">{children}</div>
    </div>
  );
}

// Every widget type drags with a small preview of the real widget
// following the cursor (same component that ends up on the canvas — see
// WidgetRenderers.tsx, just scaled down), whether it's a brand-new one
// still on the palette or an already-placed one being repositioned —
// never a generic text-pill fallback (that was the "just shows the
// widget's name, nowhere near the cursor" bug: DragOverlay's own rect
// math never reliably centered a pill sized differently from whatever it
// was dragged from, and it doesn't show what you're actually about to
// place). Reuses the sticker preview's proven approach — a plain
// fixed-position element pinned to raw pointer coordinates — for all of
// it; DragOverlay isn't used anywhere in this component anymore.
function isFullPreviewDrag(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return data.kind === "sticker-source" || data.kind === "widget-item" || data.kind === "widget-source";
}

// The floating, cursor-following drag preview matches the REAL grid
// footprint the widget actually occupies once placed — a 1-column widget
// (Favorite Card, Empty Space) previews at the real column width (measured
// live at drag start, see columnWidthRef) by WIDGET_1COL_HEIGHT tall; a
// full-width type (Listings) previews at 3 columns by that same height.
//
// This used to be a fixed 150x150 box for every 1-column type regardless
// of the canvas's actual rendered width — direct user report: repositioning
// an already-placed widget made it look like it "gets small on drag...
// not the actual size of a 1x1 grid," which is exactly what a 150px box
// looks like next to a real ~413px-wide column. The pixel-accurate,
// full-size preview already lives elsewhere too — the ghost slot INSIDE
// the stack itself (see previewWidgets above and the w.id ===
// WIDGET_GHOST_ID branch, and ColumnGhost) — but that one only shows once
// the cursor is over a real drop target; this floating copy is visible for
// the whole drag, so it needs to look like the truth too, not a rough
// stand-in.
//
// An earlier version scaled the real widget content down via a CSS
// `transform: scale()` inside a box sized only by width, letting height
// be whatever the content naturally produced — direct user report: a
// ~1000px-tall, 100px-wide box for the Listings preview. `transform`
// only changes how a box is *painted*, not the space it occupies for a
// parent computing its own auto height, so the outer box grew to the
// content's full ORIGINAL (untransformed, ~670px) height regardless of
// how small the scale-down made it look. Fixing both dimensions
// explicitly and clipping the (still scaled-down, so proportionate)
// content with `overflow-hidden` avoids that entirely — see
// DragPreviewBox below.
const DRAG_PREVIEW_LISTINGS_VIRTUAL_WIDTH = 896;

function dragPreviewSpec(
  type: string,
  columnWidth: number,
): { width: number; height: number; virtualWidth: number } {
  if (type === "listings") {
    return { width: columnWidth * 3, height: WIDGET_1COL_HEIGHT, virtualWidth: DRAG_PREVIEW_LISTINGS_VIRTUAL_WIDTH };
  }
  // empty_space and favorite_card both render directly at width/height in
  // DragPreviewBox (no virtualWidth/scale trick — see there) — virtualWidth
  // is unused for them; kept equal to width so scale computes to a no-op
  // 1 rather than a stray division-by-something-meaningless.
  return { width: columnWidth, height: WIDGET_1COL_HEIGHT, virtualWidth: columnWidth };
}

// A seller with no saved layout yet sees exactly what they saw before this
// editor existed — just their listings — rather than a blank canvas. Saving
// an intentionally-empty layout falls back to this too (see the
// profile-canvas plan: v1 doesn't distinguish "never customized" from
// "cleared it out", both read as "use the default").
const DEFAULT_WIDGETS: ProfileWidget[] = [{ id: "default-listings", type: "listings", col: 0, favoriteCard: null }];

// Owns the whole editable region of a seller's public profile — the fixed
// identity block (avatar/name/bio/rating), the Edit Profile toggle, and —
// while editing — the docked tool panel plus the canvas (one continuous
// Backdrop -> sticker layer -> foreground surface, not a separate white
// card sitting apart from it — a seam there was the #1 complaint on the
// first pass). One shared DndContext covers both the palette (drag
// sources) and the canvas (drop targets), since dnd-kit only reports a
// drop within a single context: dragging a palette chip onto the canvas
// either places a sticker at the drop point or inserts a widget into the
// stack; dragging an already-placed widget reorders it.
export default function ProfileEditor({
  profile,
  joinedAt,
  reviewSummary,
  buyerStats,
  isOwner,
  isLoggedIn,
  listings,
  watchedIds,
}: {
  profile: PublicUser;
  joinedAt: string;
  // Seller-side rating — ratings left by buyers who bought FROM this
  // person, with individual review text (linked to the #reviews section
  // below).
  reviewSummary: ReviewSummary;
  // Buyer-side rating — the seller-facing reputation summary (average
  // rating + purchase/refund/claim history) built from ratings sellers
  // left ABOUT this person as a buyer. A live aggregate (internal/
  // buyerreview.StatsFor), same "derive, don't cache" shape as
  // reviewSummary, but no per-review list/reply thread exists for it (see
  // OrderBuyerCard, the only other place this shape renders) — so unlike
  // the seller pill below, this one doesn't link anywhere.
  buyerStats: BuyerStats;
  isOwner: boolean;
  isLoggedIn: boolean;
  listings: Listing[];
  watchedIds: Set<string>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [savedStickers, setSavedStickers] = useState(profile.stickers);
  const [stickers, setStickers] = useState(profile.stickers);
  const initialWidgets = profile.widgets.length > 0 ? profile.widgets : DEFAULT_WIDGETS;
  const [savedWidgets, setSavedWidgets] = useState(initialWidgets);
  const [widgets, setWidgets] = useState(initialWidgets);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeDragData, setActiveDragData] = useState<Record<string, unknown> | null>(null);
  // Where the thing currently in hand would land right now — an index
  // into "the widgets other than the one being dragged" (see
  // previewWidgets below). Used for both a brand-new palette widget
  // being dragged in AND an already-placed widget being repositioned;
  // null whenever neither is happening (e.g. a sticker drag) or the
  // pointer isn't over a resolvable target.
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Which of the 3 columns a 1-column widget (favorite_card) currently in
  // hand would land in — independent of dragOverIndex, which only decides
  // the ROW. Unlike dragOverIndex, this doesn't reorder anything else on
  // the canvas when it changes, so it isn't debounced through
  // commitDragOverIndex — it just directly mirrors the cursor, the same
  // way the floating preview's own position does.
  const [dragOverCol, setDragOverCol] = useState(0);
  // When the LAST actual (non-debounced) dragOverIndex change happened —
  // see commitDragOverIndex below.
  const lastDragOverFlipAtRef = useRef(0);
  // The id of an already-placed widget currently being repositioned via
  // its grip handle, or null. `widgets` itself is never mutated while
  // this is set — see previewWidgets and handleDragEnd's widget-item
  // branch for why: dnd-kit's own live-reorder-during-drag machinery
  // (`useSortable`'s displacement/derivedTransform math) turned out to
  // misbehave badly for this exact interaction (confirmed via direct
  // browser testing — see SortableWidget's isDragging branch), so the
  // reorder is only ever computed for *preview* here and committed once,
  // for real, on drop.
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);
  // Live rotation of whatever sticker is currently in hand — driven by the
  // scroll wheel while dragging (see the wheel-listener effect below), reset
  // at the start of every drag and baked into the sticker on drop.
  const [dragRotationDeg, setDragRotationDeg] = useState(0);
  const [justPlacedId, setJustPlacedId] = useState<string | null>(null);
  // Raw viewport coordinates of the pointer while a sticker (not a widget)
  // is in hand — the sticker preview renders directly at this position
  // (see the fixed-position element near the end of this component),
  // sidestepping DragOverlay/modifier rect math entirely for the one case
  // where centering it actually matters.
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Every currently-mounted widget's own DOM node, keyed by widget id —
  // populated/cleared by each SortableWidget itself (see its setRefs).
  // What lets WidgetStackDropZone's remeasure effect momentarily clear a
  // widget's in-flight FLIP transform before asking dnd-kit to remeasure
  // it — see that effect's comment for why that matters.
  const widgetNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // Every widget's own top/height, frozen at the exact instant the CURRENT
  // drag started — see computeInsertIndexFromPointer's comment for why
  // this has to be a frozen snapshot rather than a live re-measurement.
  const dragStartPositionsRef = useRef<Map<string, { top: number; height: number }>>(new Map());
  // The real, live-measured single-column width, frozen at the start of
  // the current drag — what DragPreviewBox sizes the floating preview
  // from (see dragPreviewSpec), so it matches the canvas's ACTUAL
  // rendered width at whatever viewport this is, not a guessed constant.
  // 413 is just a reasonable fallback for the instant before any drag has
  // ever measured it for real.
  const columnWidthRef = useRef(413);
  const router = useRouter();
  const editable = isOwner && editMode;

  // ---- painting (see components/profile/paint/) ------------------------
  const [savedCanvas, setSavedCanvas] = useState(profile.profileCanvas);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const pushRecentColor = useCallback((hex: string) => {
    setRecentColors((prev) => [hex, ...prev.filter((c) => c !== hex)].slice(0, PAINT_RECENT_COLORS_LIMIT));
  }, []);
  const paintEngine = usePaintEngine({
    saved: savedCanvas,
    editable,
    containerRef: canvasRef,
    onColorPicked: pushRecentColor,
    onColorUsed: pushRecentColor,
  });
  // While a paint tool is armed, the paint canvas (z-5) takes the pointer
  // and everything normally interactive above it (stickers at z-10, widget
  // toolbars in the z-20 foreground) goes pointer-events-none — z-order
  // itself never changes, only who's listening. The arrow tool (or the
  // palette's Widgets tab) hands the pointer back.
  const paintArmed = editable && paintEngine.tool !== "arrange";

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const dirty =
    JSON.stringify(stickers) !== JSON.stringify(savedStickers) ||
    JSON.stringify(widgets) !== JSON.stringify(savedWidgets) ||
    paintEngine.paintDirty;

  // The widget currently being repositioned (if any) and its type — needed
  // both to build previewWidgets below and to render the floating
  // cursor-following copy of it near the end of this component.
  const draggingWidget = draggingWidgetId ? widgets.find((w) => w.id === draggingWidgetId) : undefined;
  const draggingFavoriteCard = draggingWidget?.favoriteCard ?? undefined;

  // What the stack actually renders. Three cases:
  //  - Idle: just `widgets`.
  //  - A brand-new palette widget hovering the stack: `widgets` plus a
  //    ghost slot at dragOverIndex, so the real widgets already there
  //    visibly flow around it before anything's actually been dropped.
  //  - An already-placed widget being repositioned: the OTHER widgets,
  //    with the dragged widget itself reinserted at dragOverIndex. This
  //    reuses React's key-based reconciliation (SortableWidget is keyed
  //    by widget.id) — moving it to a different array index re-parents
  //    the same DOM node/component instance rather than remounting it,
  //    so the drag session (pointer capture, useSortable's own state)
  //    stays intact even though its position in the list changes on
  //    every dragOverIndex update. The dragged widget's own in-place
  //    node renders as a plain placeholder while this is happening (see
  //    SortableWidget) — the real visual is the floating preview.
  const previewWidgets = (() => {
    if (activeDragData?.kind === "widget-source" && dragOverIndex !== null) {
      return [
        ...widgets.slice(0, dragOverIndex),
        { id: WIDGET_GHOST_ID, type: activeDragData.widgetType as string, col: dragOverCol, favoriteCard: null },
        ...widgets.slice(dragOverIndex),
      ];
    }
    if (draggingWidgetId && draggingWidget) {
      const others = widgets.filter((w) => w.id !== draggingWidgetId);
      if (dragOverIndex === null) return widgets; // no resolvable target yet — leave it where it started
      const idx = Math.min(dragOverIndex, others.length);
      const previewDragged = { ...draggingWidget, col: dragOverCol };
      return [...others.slice(0, idx), previewDragged, ...others.slice(idx)];
    }
    return widgets;
  })();

  // A stable string identifying the CURRENT arrangement (ids in order),
  // passed down to every SortableWidget so its own reflow effect can
  // depend on "did the arrangement actually change" instead of "did
  // ProfileEditor re-render for any reason at all" — see the
  // useLayoutEffect in SortableWidget for why that distinction turned out
  // to matter a lot. previewWidgets itself is a fresh array every render
  // (recomputed above), so its own reference is never a usable dependency;
  // this string is stable across renders where nothing about the order
  // changed, even though previewWidgets' reference isn't.
  const stackOrderKey = previewWidgets.map((w) => w.id).join("|");

  // While a sticker or a full-preview widget is actively being dragged:
  // track the cursor for the floating preview below via a plain native
  // listener — not dnd-kit's activatorEvent+delta math, which is what
  // handleDragEnd still (correctly) uses for the actual drop position, but
  // proved unreliable for driving a live, continuously-updating on-screen
  // position. Raw clientX/clientY off a real pointermove event has nothing
  // left in the chain to miscalibrate. Scroll-to-rotate stays sticker-only.
  useEffect(() => {
    if (!isFullPreviewDrag(activeDragData)) return;
    function handleWheel(e: WheelEvent) {
      if (activeDragData?.kind !== "sticker-source") return;
      e.preventDefault();
      setDragRotationDeg((prev) => prev + e.deltaY * ROTATE_SENSITIVITY);
    }
    function handlePointerMove(e: PointerEvent) {
      setPointerPos({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [activeDragData]);

  function handleDragStart(event: DragStartEvent) {
    const data = (event.active.data.current as Record<string, unknown>) ?? null;
    setActiveDragData(data);
    setDragRotationDeg(0);

    // Freeze every widget's own position *before* anything about this
    // drag has had a chance to move any of them — see
    // computeInsertIndexFromPointer's comment for why. This runs
    // synchronously, ahead of the setDraggingWidgetId/setDragOverIndex
    // calls below (and the re-render + reflow they trigger), so
    // getBoundingClientRect() here still reflects the true pre-drag
    // layout no matter which kind of drag this is.
    //
    // Plain viewport-relative rect.top, deliberately NOT adjusted for
    // scroll — re-enabling auto-scroll (see the DndContext prop below)
    // made this worth double-checking carefully rather than assuming, but
    // dnd-kit's own delta already handles it: delta.y is (raw pointer
    // movement) + (scrollY-now minus scrollY-at-drag-start), so
    // `pointer.y = activator.clientY + delta.y` algebraically simplifies
    // to `currentDocumentRelativeCursorY - scrollYAtDragStart`. A widget's
    // plain rect.top captured right here, at that same drag-start moment,
    // is exactly that widget's position in that same "minus
    // scrollYAtDragStart" frame — comparing the two directly is already
    // correct through any amount of scrolling. Adding window.scrollY to
    // either side here would double-count the scroll offset and bias
    // every comparison by a constant equal to wherever the page happened
    // to be scrolled when the drag started.
    const snapshot = new Map<string, { top: number; height: number }>();
    widgets.forEach((w) => {
      const el = widgetNodesRef.current.get(w.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        snapshot.set(w.id, { top: rect.top, height: rect.height });
      }
    });
    dragStartPositionsRef.current = snapshot;

    // Live-measure the real single-column width for DragPreviewBox — read
    // straight from the browser's own resolved grid track size, not
    // computed from any of this component's own layout constants, so it's
    // exactly right at whatever viewport width the canvas is actually
    // rendering at right now.
    const gridEl = canvasRef.current?.querySelector<HTMLElement>(".grid-cols-3");
    if (gridEl) {
      const firstTrack = parseFloat(getComputedStyle(gridEl).gridTemplateColumns.split(" ")[0]);
      if (Number.isFinite(firstTrack) && firstTrack > 0) columnWidthRef.current = firstTrack;
    }

    if (data?.kind === "widget-item") {
      // Seed dragOverIndex to the widget's own current position (its
      // index in the full `widgets` array) rather than null — inserting
      // an item back into "the others" at its own original index exactly
      // reproduces the starting order, so the stack doesn't visibly jump
      // the instant you pick something up, before you've moved it at all.
      const id = String(event.active.id);
      setDraggingWidgetId(id);
      const startIndex = widgets.findIndex((w) => w.id === id);
      setDragOverIndex(startIndex === -1 ? null : startIndex);
      const startWidget = widgets.find((w) => w.id === id);
      setDragOverCol(startWidget?.col ?? 0);
    } else {
      setDraggingWidgetId(null);
      setDragOverIndex(null);
      setDragOverCol(0);
    }
    const activator = event.activatorEvent as MouseEvent;
    setPointerPos({ x: activator.clientX, y: activator.clientY });
  }

  // Whether the cursor is in the top half or the bottom half of the
  // hovered widget decides whether the thing in hand lands before or
  // after it — a plain vertical 50/50 split of that widget's own rect,
  // nothing else. This used to also factor in horizontal position (compare
  // |dx| vs |dy| from the widget's center, let whichever was larger decide
  // the axis), on the theory that a narrow 1-column cell could need
  // left/right reordering too — but every widget in the array is either
  // full-width (Listings, col-span-3) or narrow-but-alone-in-its-type
  // (Favorite Card, and column placement for it is handled entirely
  // separately by dragOverCol/ColumnGhost, never by this function). For a
  // full-width row, "distance from horizontal center" can be up to half
  // the row's own width — hundreds of pixels — which routinely swamped a
  // much smaller vertical offset and made the row flip before/after for
  // reasons that had nothing to do with whether the cursor was above or
  // below the widget. Direct complaint: "if I put the cursor on the top
  // 50% of that widget, put mine above it; bottom 50%, below it — right
  // now the up/down doesn't make sense with where my cursor is." A pure
  // vertical split is what actually matches that.
  //
  // The pointer position, not `active.rect.current.translated`'s center,
  // is what this needs to compare against — confirmed by direct browser
  // testing that using the latter is systematically wrong here: dnd-kit
  // computes that rect as the widget's ORIGINAL footprint shifted by the
  // raw pointer delta, so its "center" is offset from the actual cursor
  // by up to half that widget's own height/width. For Listings
  // (670px tall) that's a ~335px skew — enough to make the drag
  // essentially never resolve "insert before" correctly when Listings is
  // the one in hand. `activatorEvent` (the original pointerdown) plus
  // `delta` (total movement since) gives the true current pointer
  // position — same technique handleDragEnd already uses for sticker
  // placement.
  //
  // Deliberately NOT derived from `over` (whichever droppable dnd-kit's
  // own collision detection resolved to) at all — that was the source of
  // a real, confirmed bug. The previous version asked `over` which single
  // widget the pointer was on top of and compared against just that one's
  // rect, falling back to "append at the very end" whenever `over`
  // resolved to the general "widget-stack" container instead of a
  // specific widget. That fallback is right for an empty canvas, but
  // wrong for hovering above the very first widget: inserting before
  // Listings pushes Listings DOWN to make room for the ghost, which
  // pushes it out from under the cursor — the pointer ends up in the
  // stack's own general gap, over "widget-stack," not over Listings
  // anymore. Reading that as "append at the end" moves Listings back up
  // to its original spot, which puts the cursor back in Listings' top
  // half, which says "insert before" again, which pushes Listings down
  // again... Confirmed via direct browser testing that this was a real,
  // continuous feedback loop, not a one-off glitch: dragging toward the
  // top of Listings bounced between the two states instead of settling
  // above it. Dragging toward the BOTTOM never showed this, because
  // Listings never moves when something inserts after it — nothing pushes
  // it out from under the cursor.
  //
  // Walking every OTHER widget's position and asking "is the pointer
  // still above this one's midpoint" answers "above everything," "below
  // everything," and "between these two" all the same way, with no
  // separate carve-out for any of them, and no dependency on which
  // droppable dnd-kit's own collision math happened to resolve to.
  //
  // Positions come from dragStartPositionsRef — a snapshot frozen at the
  // exact instant the current drag started — not a live
  // getBoundingClientRect() read. That distinction is what fixed a second,
  // separate bug found repositioning an ALREADY-PLACED widget (as opposed
  // to dragging a brand-new one in from the palette, which never showed
  // this): direct report was the other widgets "bouncing up and down like
  // it doesn't know where to drop it" while dragging Listings around.
  // Root cause: `others` (this function's own `list` argument) already
  // excludes the widget being dragged, but previewWidgets still reinserts
  // that widget's own placeholder back into the rendered stack at
  // whatever index was last computed (see previewWidgets above) — and
  // THAT placeholder, moving through the list, physically pushes the
  // OTHER real widgets up and down as a side effect, the same way any
  // reordering item would. A live re-measurement of those other widgets'
  // positions was therefore reading a moving target: reposition the
  // placeholder → an "other" widget's measured position shifts → that
  // shift changes what pointerY compares against → which can flip the
  // computed index → which moves the placeholder again → repeat. Freezing
  // everyone's position once, before the drag (and its own preview
  // reflow) ever starts, removes the moving target entirely — direct
  // fix suggested in feedback: "take a snapshot of where all widgets are
  // but remove the one I'm dragging, so it can understand where I'm
  // trying to put it." (The snapshot itself holds everyone; `list`
  // already being `others` is what "removes" the dragged one from
  // consideration here.)
  //
  // Freezing positions killed the moving-target bounce, but a THIRD,
  // separate bug remained even with a perfectly frozen boundary: direct
  // report was Listings looking like "it can't decide if it wants to go
  // above the other widget" — a persistent, repeating flip, not a freeze.
  // Confirmed by comparing two test drags to the exact same final cursor
  // position: one single jump settled cleanly; the other, moving through
  // the same path in many small steps, never committed. That's the
  // signature of a plain midpoint comparison with no dead zone — real
  // cursor movement (and even a "held still" mouse) always carries a few
  // pixels of jitter, and a bare `pointerY < mid` check flips its answer
  // every single time that jitter crosses the line. DRAG_OVER_FLIP_HYSTERESIS_MS
  // (time-based, see commitDragOverIndex) can't fix this on its own: it
  // only paces how OFTEN an already-decided flip is allowed to apply, not
  // whether the underlying comparison keeps demanding one — a
  // continuously flapping raw signal just becomes a slower, still-visible
  // periodic flap instead of a fast one.
  //
  // currentIndex adds a real position-based dead zone (a Schmitt
  // trigger): whichever side of the boundary is already selected gets to
  // keep it until the pointer crosses a full INSERT_ZONE_MARGIN_PX past
  // the midpoint in the OTHER direction, not just past the midpoint
  // itself. Small jitter near the line can no longer flip anything —
  // only a deliberate move across the whole zone can. currentIndex is
  // null only for the very first resolution of a drag, when there's
  // nothing yet to be biased toward, so that case falls back to the
  // plain midpoint with no margin.
  function computeInsertIndexFromPointer(
    pointerY: number,
    list: ProfileWidget[],
    positions: Map<string, { top: number; height: number }>,
    currentIndex: number | null,
  ): number {
    for (let i = 0; i < list.length; i++) {
      const pos = positions.get(list[i].id);
      if (!pos) continue;
      const mid = pos.top + pos.height / 2;
      const threshold =
        currentIndex === null ? mid : currentIndex <= i ? mid + INSERT_ZONE_MARGIN_PX : mid - INSERT_ZONE_MARGIN_PX;
      if (pointerY < threshold) return i;
    }
    return list.length;
  }

  // Applies a computed dragOverIndex, but damps rapid back-and-forth
  // flipping between two values — see DRAG_OVER_FLIP_HYSTERESIS_MS for
  // the full why. Setting `next` to null (hovering the trash — see
  // handleDragMove) always goes through immediately, same as the very
  // first resolution in a drag — only an actual value-to-value flip
  // within the window gets ignored. Note handleDragMove no longer calls
  // this with null just because `over` is null (a real, ordinary gap in
  // droppable coverage above the grid, not "abandon the drag") — see its
  // comment.
  function commitDragOverIndex(next: number | null) {
    if (next === dragOverIndex) return;
    const now = performance.now();
    if (dragOverIndex !== null && next !== null && now - lastDragOverFlipAtRef.current < DRAG_OVER_FLIP_HYSTERESIS_MS) {
      return;
    }
    lastDragOverFlipAtRef.current = now;
    setDragOverIndex(next);
  }

  // Wired to DndContext's onDragMove, not onDragOver — deliberately.
  // dnd-kit's own onDragOver is dispatched from an effect keyed only on
  // `[overId]` (see @dnd-kit/core's DndContext source): it fires once when
  // the resolved droppable's id *changes*, and not again until it changes
  // to something else. Any full-width droppable (the "widget-stack"
  // container, or a col-span-3 Listings widget) spans the entire row, so
  // sweeping the cursor anywhere inside it — left to right for column
  // choice, or top to bottom for insert-before/after — never changes
  // overId at all, and onDragOver simply never fires again. That's the
  // exact "picks the first spot it recognizes and only ever highlights
  // that one" bug: whatever column/side was true the instant the pointer
  // entered the droppable is what stayed on screen for the rest of the
  // drag, regardless of how far the cursor kept moving inside it.
  // onDragMove is dispatched from a *different* effect, keyed on
  // `[scrollAdjustedTranslate.x, scrollAdjustedTranslate.y]` — i.e. every
  // real pointer movement, continuously, independent of which droppable
  // is currently active. Same event shape (DragMoveEvent and DragOverEvent
  // are structurally identical), so this is a straight swap of which
  // DndContext prop the handler is wired to, not a rewrite of the logic
  // itself. Neither branch below touches `widgets` itself; both only
  // update dragOverIndex/dragOverCol, and previewWidgets (above) is what
  // actually renders the live preview — see its comment for why. The real
  // reorder (or insertion) only happens once, in handleDragEnd, on drop.
  function handleDragMove(event: DragMoveEvent) {
    const { active, over, delta } = event;
    const kind = (active.data.current as { kind?: string } | undefined)?.kind;
    const activator = event.activatorEvent as MouseEvent;
    const pointer = { x: activator.clientX + delta.x, y: activator.clientY + delta.y };

    // Column tracking is computed against the canvas's own rect — not
    // whatever droppable `over` happens to resolve to. `over.rect` varies
    // depending on WHICH droppable resolved (the general "widget-stack"
    // container vs. a specific widget's own node), and those disagree by
    // exactly the container's own padding (e.g. left 57 vs 85, width 1326
    // vs 1270 — a 28px-per-side inset) since a grid item's rect excludes
    // the padding its parent container's rect includes. Computed
    // unconditionally, before either kind's `!over`/trash early return
    // below, so a `null`/trash `over` can never freeze it either.
    if (canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      setDragOverCol(computeCol(pointer.x, canvasRect));
    }

    if (kind === "widget-source") {
      // Hovering the trash means "don't insert this" — no ghost slot to
      // show in the stack while that's the intent (see handleDragEnd).
      if (over?.id === WIDGET_TRASH_ID) {
        commitDragOverIndex(null);
        return;
      }
      // `over` resolving to nothing is NOT the same as "abandon the
      // insertion" — WidgetStackDropZone's droppable only covers the tight
      // grid element itself, not the bio/header space above it, so a
      // completely ordinary drag gesture toward "insert above everything"
      // passes through a real gap where `over` is null on the way there.
      // Resetting dragOverIndex to null here silently reverted an
      // already-correct placement the instant the pointer left the grid's
      // own bounds — exactly the "can't drop above the first row" bug.
      // Keep the last-committed index instead; it only ever gets cleared
      // by the trash-hover branch above or a real drop/cancel.
      if (!over) return;
      commitDragOverIndex(computeInsertIndexFromPointer(pointer.y, widgets, dragStartPositionsRef.current, dragOverIndex));
      return;
    }

    if (kind === "widget-item") {
      const draggedId = String(active.id);
      if (over?.id === WIDGET_TRASH_ID) {
        commitDragOverIndex(null);
        return;
      }
      // Same reasoning as the widget-source branch above: a null `over`
      // mid-gesture is a real gap in droppable coverage, not an
      // abandoned drag — preserve the last-committed index rather than
      // resetting it.
      if (!over) return;
      // The dragged widget's own droppable is disabled while it's active
      // (see SortableWidget) — keeps `over` from ever resolving back to
      // itself, which otherwise could out-compete the actual trash button
      // for collision priority when they overlap. computeInsertIndexFromPointer
      // itself no longer depends on what `over` resolved to at all, only
      // on this `others` list (the dragged widget excluded) and where the
      // pointer actually is.
      const others = widgets.filter((w) => w.id !== draggedId);
      commitDragOverIndex(computeInsertIndexFromPointer(pointer.y, others, dragStartPositionsRef.current, dragOverIndex));
    }
  }

  function handleDragCancel() {
    setActiveDragData(null);
    setPointerPos(null);
    setDragOverIndex(null);
    setDragOverCol(0);
    setDraggingWidgetId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragData(null);
    setPointerPos(null);
    const { active, over, delta } = event;
    const kind = (active.data.current as { kind?: string } | undefined)?.kind;

    // Dropping a widget on the trash target — an already-placed widget is
    // actually removed (same end result as its toolbar's × button, just
    // via drag); a widget still in hand from the palette just isn't added,
    // which is already what dropping it anywhere non-canvas does, so this
    // is really just giving that same "changed your mind" gesture an
    // explicit, discoverable target.
    if (over?.id === WIDGET_TRASH_ID && (kind === "widget-item" || kind === "widget-source")) {
      if (kind === "widget-item") removeWidget(String(active.id));
      setDragOverIndex(null);
      setDraggingWidgetId(null);
      return;
    }

    if (kind === "sticker-source") {
      if (stickers.length >= MAX_STICKERS || !canvasRef.current) return;
      const stickerKind = (active.data.current as { stickerKind: string }).stickerKind;
      const activator = event.activatorEvent as MouseEvent;
      const dropX = activator.clientX + delta.x;
      const dropY = activator.clientY + delta.y;
      const rect = canvasRef.current.getBoundingClientRect();
      if (dropX < rect.left || dropX > rect.right || dropY < rect.top || dropY > rect.bottom) return;
      const xPct = clamp(((dropX - rect.left) / rect.width) * 100, 0, 100);
      const yPx = Math.max(0, dropY - rect.top);
      const id = crypto.randomUUID();
      setStickers((prev) => [
        ...prev,
        { id, kind: stickerKind, xPct, yPx, rotationDeg: normalizeRotation(dragRotationDeg), scale: 1 },
      ]);
      setJustPlacedId(id);
      setTimeout(() => setJustPlacedId((cur) => (cur === id ? null : cur)), STICKER_LAND_MS);
      return;
    }

    if (kind === "widget-source") {
      setDragOverIndex(null);
      if (!over) return;
      const type = (active.data.current as { widgetType: string }).widgetType;
      // No per-type cap — matches the backend's SetWidgets: a seller can
      // place as many of any one type as they want (three Favorite Cards,
      // three Listings feeds, ...), blocked only by the overall
      // maxWidgets ceiling below.
      if (widgets.length >= MAX_WIDGETS) return;
      const fresh: ProfileWidget = { id: crypto.randomUUID(), type, col: dragOverCol, favoriteCard: null };
      const index = dragOverIndex ?? widgets.length;
      setWidgets((prev) => [...prev.slice(0, index), fresh, ...prev.slice(index)]);
      return;
    }

    if (kind === "widget-item") {
      // The reorder was only ever a *preview* up to this point (see
      // previewWidgets and handleDragMove above) — this is where it
      // actually happens, once, reconstructing `widgets` to exactly
      // match whatever arrangement was last shown. Reusing the live
      // preview's own math here (rather than recomputing anything) means
      // the drop can never visually disagree with what was just on
      // screen a moment before.
      const id = String(active.id);
      const targetIndex = dragOverIndex;
      const targetCol = dragOverCol;
      setDragOverIndex(null);
      setDraggingWidgetId(null);
      if (targetIndex === null) return; // no resolvable target — snaps back to where it started
      setWidgets((prev) => {
        const dragged = prev.find((w) => w.id === id);
        if (!dragged) return prev;
        const others = prev.filter((w) => w.id !== id);
        const idx = Math.min(targetIndex, others.length);
        return [...others.slice(0, idx), { ...dragged, col: targetCol }, ...others.slice(idx)];
      });
    }
  }

  function removeWidget(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }

  // Bake a floating sticker into the paint bitmap at its exact rendered
  // position/rotation/scale, then remove it from the floating array — after
  // this it's pixels (erasable, eyedroppable), not a movable object. The
  // undo hooks keep the two halves consistent: undoing the stamp restores
  // both the pixels AND the floating sticker; redo removes it again. If
  // rasterization fails (image didn't decode), the sticker just stays
  // floating — never silently lost.
  async function handleStamp(id: string) {
    const sticker = stickers.find((s) => s.id === id);
    const src = sticker && profileStickerSrc(sticker.kind);
    if (!sticker || !src) return;
    const ok = await paintEngine.stampSticker(sticker, src, STICKER_SIZE, {
      onUndo: () => setStickers((prev) => (prev.some((s) => s.id === id) ? prev : [...prev, sticker])),
      onRedo: () => setStickers((prev) => prev.filter((s) => s.id !== id)),
    });
    if (ok) setStickers((prev) => prev.filter((s) => s.id !== id));
  }

  function setFavoriteCard(id: string, card: FavoriteCardRef | null) {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, favoriteCard: card } : w)));
  }

  // The paint half of a save: export the bitmap as a lossless PNG, upload
  // it to Storage, record the descriptor, then clean up the superseded
  // object. Sequenced so a failed descriptor POST never leaves the profile
  // pointing at nothing (the fresh upload is best-effort deleted instead),
  // and the OLD object is only deleted after the new descriptor is
  // durably recorded. A fully-erased canvas saves as null ("no painting")
  // rather than uploading a blank PNG.
  async function savePaint(): Promise<Me | null> {
    if (!paintEngine.paintDirty) return null;
    if (paintEngine.isBlank()) {
      if (!savedCanvas) return null;
      const me = await setMyCanvas(null);
      void deleteProfileCanvas(savedCanvas.url);
      return me;
    }
    const exported = await paintEngine.exportBlob();
    if (!exported) return null;
    const url = await uploadProfileCanvas(exported.blob);
    let me: Me;
    try {
      me = await setMyCanvas({ url, width: exported.width, height: exported.height });
    } catch (err) {
      void deleteProfileCanvas(url);
      throw err;
    }
    if (savedCanvas) void deleteProfileCanvas(savedCanvas.url);
    return me;
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const stickersChanged = JSON.stringify(stickers) !== JSON.stringify(savedStickers);
      const widgetsChanged = JSON.stringify(widgets) !== JSON.stringify(savedWidgets);
      const paintChanged = paintEngine.paintDirty;
      const [meFromStickers, meFromWidgets, meFromCanvas] = await Promise.all([
        stickersChanged ? setMyStickers(stickers) : null,
        widgetsChanged ? setMyWidgets(widgets) : null,
        savePaint(),
      ]);
      const settledStickers = meFromStickers?.stickers ?? stickers;
      // No DEFAULT_WIDGETS fallback here — that's only ever the *initial*
      // seed for a profile that's never been touched (see `initialWidgets`
      // above). Re-applying it after a real save was the bug: remove your
      // last widget, hit Save, and it silently put Listings right back —
      // an explicit save has to be able to result in zero widgets if
      // that's genuinely what you did.
      const settledWidgets = meFromWidgets?.widgets ?? widgets;
      setStickers(settledStickers);
      setSavedStickers(settledStickers);
      setWidgets(settledWidgets);
      setSavedWidgets(settledWidgets);
      if (paintChanged) {
        // The server's returned descriptor is the settled truth (this
        // component only seeds from props on mount, so don't rely on
        // router.refresh() for it) — and the just-saved pixels become the
        // Cancel baseline.
        if (meFromCanvas) setSavedCanvas(meFromCanvas.profileCanvas);
        await paintEngine.markSaved();
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save your profile.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setStickers(savedStickers);
    setWidgets(savedWidgets);
    // Paint reverts to the last-saved snapshot (or empty if never saved).
    // Because savedStickers is restored too, a cancelled stamp comes back
    // as a floating sticker with its baked pixels gone — consistent.
    paintEngine.restoreSaved();
    setError("");
  }

  // dnd-kit's own auto-scroll (on by default) was temporarily turned off
  // here — it was compounding with a since-fixed bug (computeInsertIndexFromPointer
  // flapping with no position-based dead zone, see INSERT_ZONE_MARGIN_PX)
  // into a genuine main-thread lockup: auto-scrolling fires onDragMove
  // continuously via its own scrollAdjustedTranslate changes, with no real
  // pointer movement needed to keep triggering it, and every one of those
  // firings was re-deciding an insert index that kept flapping, re-running
  // this canvas's reflow/remeasure work (WidgetStackDropZone's effect,
  // SortableWidget's FLIP animation) in an unbounded loop. Direct product
  // ask afterward was to bring auto-scroll back — dragging a widget to the
  // very top or bottom of the page should scroll it into view, not require
  // dropping and using the scroll wheel — and with the flapping itself
  // fixed at its actual source, auto-scroll no longer has a runaway
  // trigger to compound with: dragStartPositionsRef's snapshot values stay
  // meaningful through any amount of auto-scrolling (see handleDragStart's
  // comment on why no scroll adjustment is needed there), so re-enabling
  // this doesn't reintroduce the lockup — confirmed via direct browser
  // testing, dragging to both the top and bottom edge repeatedly with no
  // freeze and no bounce.
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div>
        <div
          ref={canvasRef}
          className="relative overflow-hidden rounded-[28px] border border-black/5 shadow-[0_1px_2px_rgba(15,23,41,0.04),0_24px_56px_-28px_rgba(15,23,41,0.28)]"
        >
          {/* Deliberately faint — see .profile-canvas-backdrop in
              globals.css. This is the layer the design note used to call a
              no-op flat fill; it's now a real (if quiet) surface so the
              canvas reads as its own "board" distinct from the page behind
              it, without competing with stickers/widgets sitting on top. */}
          <div className="profile-canvas-backdrop absolute inset-0 z-0" />
          {/* The freehand painting layer — z-5, above the backdrop, below
              stickers (a floating sticker renders over the paint until
              it's stamped and BECOMES paint). Visitors get the saved PNG
              as a plain <img>; the live bitmap only exists for the owner
              in edit mode. */}
          <PaintLayer
            engine={paintEngine}
            savedCanvas={savedCanvas}
            editable={editable}
            paintArmed={paintArmed}
            containerRef={canvasRef}
          />
          {/* editable flips off while a paint tool is armed — StickerBoard's
              non-editable branch is pointer-events-none, which is exactly
              what lets strokes reach the paint canvas underneath it. */}
          <StickerBoard
            stickers={stickers}
            onChange={setStickers}
            editable={editable && !paintArmed}
            justPlacedId={justPlacedId}
            onStamp={handleStamp}
          />

          {/* Truthful stacking: this sits above the sticker layer in both
              edit and view mode (a sticker "behind" a headline should stay
              behind it while you're placing it too, not just after you're
              done) — but while editing, its own EMPTY space (padding,
              gaps, plain text) needs to let clicks fall through to
              whatever sticker is sitting underneath, or one placed near
              text becomes unreachable. Real controls opt back in with
              their own pointer-events-auto below; that's the only thing
              that changes, not the paint order. */}
          <div className={`relative z-20 ${editable ? "pointer-events-none" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-4 p-6 sm:p-7">
              <div className="flex items-center gap-4">
                {/* Picture, name, and rating each get their own small white
                    card — tiny padding, not a big block — now that the
                    background behind them can be an arbitrary painted
                    canvas instead of the old quiet backdrop fill. A dark
                    heading or gray star-count text sitting directly on
                    top of freehand artwork is unreadable the moment the
                    artwork gets busy near it; a little opaque white
                    underneath each piece keeps it legible while the
                    canvas still shows through everywhere around and
                    between them, which is the point of keeping the
                    padding tight rather than one big card swallowing the
                    whole header. */}
                <div className="rounded-full bg-white p-1 shadow-[0_2px_10px_rgba(15,23,41,0.12)] ring-1 ring-black/5">
                  <Avatar label={profile.username ?? "Seller"} size={96} />
                </div>
                <div className="flex flex-col items-start gap-1.5">
                  <div className="rounded-xl bg-white px-2.5 py-1 shadow-[0_2px_10px_rgba(15,23,41,0.12)] ring-1 ring-black/5">
                    <h1 className="text-2xl font-bold leading-tight tracking-tight text-gray-900">
                      {profile.username}
                    </h1>
                    <p className="text-xs font-medium tracking-wide text-gray-400 uppercase">
                      Member since {joinedAt}
                    </p>
                  </div>
                  {/* Two separate ratings, not one — this person's
                      standing as a SELLER (ratings buyers left on
                      purchases from them, with individual review text
                      and replies below at #reviews) and as a BUYER
                      (ratings sellers left about their behavior as a
                      customer — how they pay, communicate, and how often
                      a sale went bad). Distinct data, distinct pills, so
                      neither number is misread as describing the other.
                      Side by side (flex-wrap so they still stack on a
                      narrow viewport instead of overflowing), not two
                      stacked rows — they're peers, not a primary/secondary
                      pair. */}
                  <div className="flex flex-wrap items-start gap-1.5">
                    <div className="rounded-xl bg-white px-2.5 py-1 shadow-[0_2px_10px_rgba(15,23,41,0.12)] ring-1 ring-black/5">
                      <p className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase">Selling</p>
                      <a
                        href="#reviews"
                        className="pointer-events-auto inline-flex items-center gap-2 transition-opacity hover:opacity-70"
                        title="Jump to reviews"
                      >
                        <StarRating rating={reviewSummary.averageRating} />
                        <span className="text-sm text-gray-500 underline decoration-dotted underline-offset-2">
                          {reviewSummary.count > 0
                            ? `${reviewSummary.averageRating.toFixed(1)} (${reviewSummary.count} review${reviewSummary.count === 1 ? "" : "s"})`
                            : "No reviews yet"}
                        </span>
                      </a>
                      {reviewSummary.count > 0 && (
                        <p className="mt-1 text-xs text-gray-500">
                          Condition Accuracy {reviewSummary.averageConditionAccuracy.toFixed(1)} · Shipping
                          Speed {reviewSummary.averageShippingSpeed.toFixed(1)} · Trustworthiness{" "}
                          {reviewSummary.averageTrustworthiness.toFixed(1)}
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl bg-white px-2.5 py-1 shadow-[0_2px_10px_rgba(15,23,41,0.12)] ring-1 ring-black/5">
                      <p className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase">Buying</p>
                      <div className="inline-flex items-center gap-2">
                        <StarRating rating={buyerStats.averageRating} />
                        <span className="text-sm text-gray-500">
                          {buyerStats.reviewCount > 0
                            ? `${buyerStats.averageRating.toFixed(1)} (${buyerStats.reviewCount} review${buyerStats.reviewCount === 1 ? "" : "s"})`
                            : "No buyer reviews yet"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {isOwner ? (
                <div className="pointer-events-auto flex flex-col items-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditMode(true)}
                    className="flex items-center gap-1.5 rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-[0_2px_8px_rgba(15,23,41,0.25)] transition-all hover:-translate-y-0.5 hover:bg-brand-navy/90 hover:shadow-[0_6px_16px_rgba(15,23,41,0.3)]"
                  >
                    <Pencil size={14} /> Edit Profile
                  </button>
                  <Link href="/account/settings" className="text-xs text-gray-400 hover:underline">
                    Account Settings
                  </Link>
                </div>
              ) : (
                isLoggedIn && (
                  <div className="pointer-events-auto w-full max-w-xs sm:w-auto">
                    <MessageSellerButton recipientId={profile.id} recipientLabel={profile.username ?? "Seller"} />
                  </div>
                )
              )}
            </div>

            {profile.bio && (
              <div className="mx-6 mt-1 mb-2 inline-block max-w-2xl rounded-xl bg-white px-3 py-1.5 shadow-[0_2px_10px_rgba(15,23,41,0.12)] ring-1 ring-black/5 sm:mx-7">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{profile.bio}</p>
              </div>
            )}

            {/* SortableContext still wraps every widget purely so
                useSortable can hand out attributes/listeners/setNodeRef/
                isDragging (see SortableWidget) — the reflow animation
                itself is hand-rolled (see SortableWidget's
                useLayoutEffect and the WIDGET_REFLOW_MS/EASING comment
                above) and doesn't read anything from this context, so
                `items` here isn't load-bearing for that. Left as the
                real `widgets` ids (ghost excluded) since the ghost was
                never a registered sortable/droppable node anyway. */}
            <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
              <WidgetStackDropZone
                stackOrderKey={stackOrderKey}
                widgetIds={widgets.map((w) => w.id)}
                widgetNodesRef={widgetNodesRef}
              >
                {widgets.length === 0 && editable && (
                  <div className="animate-canvas-hint-pulse col-span-3 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-border py-12 text-center">
                    <LayoutGrid size={20} className="text-gray-300" />
                    <p className="text-xs font-medium text-gray-400">Drag a widget here from the panel to get started</p>
                  </div>
                )}
                {previewWidgets.map((w) =>
                  w.id === WIDGET_GHOST_ID ? (
                    // Real content, not a fixed h-64 box — a generic
                    // height had nothing to do with how tall the widget
                    // actually is once placed (Listings, full real cards,
                    // vs. an unconfigured Favorite Card's short
                    // placeholder), so the *other* widgets were making
                    // room for the wrong amount of space. Rendering the
                    // real thing (Listings for real, or
                    // FavoriteCardWidget's own real empty-state
                    // placeholder — a brand-new widget from the palette
                    // never has a card picked yet) means the gap this
                    // opens up is exactly the size the widget will
                    // actually be.
                    w.type === "listings" ? (
                      <div key={w.id} className="animate-canvas-hint-pulse col-span-3">
                        <div className="rounded-2xl border-2 border-dashed border-brand-gold/60 bg-brand-gold/5 p-5 sm:p-6">
                          <ListingsWidget listings={listings} watchedIds={watchedIds} isLoggedIn={isLoggedIn} />
                        </div>
                      </div>
                    ) : (
                      // A 1-column widget's ghost sits in its own actual
                      // target column (see ColumnGhost) — sharing a row
                      // with whatever else is already there exactly like
                      // the real, dropped widget will. Neither Empty Space
                      // nor Favorite Card gets any padding wrapper here —
                      // both skip WidgetShell in their real, dropped
                      // rendering too (see SortableWidget's shell-skip), so
                      // the ghost's footprint matches exactly.
                      <ColumnGhost key={w.id} col={w.col}>
                        {w.type === "empty_space" ? <EmptySpaceWidget editable /> : <FavoriteCardWidget card={null} editable />}
                      </ColumnGhost>
                    )
                  ) : (
                    <SortableWidget
                      key={w.id}
                      widget={w}
                      // Same paint-mode lockout as StickerBoard above: the
                      // non-editable branch drops the pointer-events-auto
                      // toolbar (absolutely positioned, so canvas height
                      // doesn't change between the two states).
                      editable={editable && !paintArmed}
                      listings={listings}
                      watchedIds={watchedIds}
                      isLoggedIn={isLoggedIn}
                      stackOrderKey={stackOrderKey}
                      widgetNodesRef={widgetNodesRef}
                      onRemove={() => removeWidget(w.id)}
                      onFavoriteCardChange={(card) => setFavoriteCard(w.id, card)}
                    />
                  ),
                )}
              </WidgetStackDropZone>
            </SortableContext>
          </div>
        </div>

        {editable && (
          <ProfileEditorPalette
            widgetCount={widgets.length}
            stickerCount={stickers.length}
            listings={listings}
            watchedIds={watchedIds}
            isLoggedIn={isLoggedIn}
            dirty={dirty}
            saving={saving}
            error={error}
            paintEngine={paintEngine}
            recentColors={recentColors}
            onPickRecentColor={(hex) => paintEngine.setColor(hex)}
            onSave={handleSave}
            onCancel={handleCancel}
            onDone={() => setEditMode(false)}
          />
        )}
      </div>

      {/* Sticker preview: a plain fixed-position element pinned directly to
          the raw pointer coordinates, not DragOverlay — same STICKER_SIZE
          the sticker lands at once placed, so there's no shrink-on-drop
          moment, and translate(-50%,-50%) on a fixed element centered at
          the exact pointer position is unambiguous, unlike trying to get
          DragOverlay's own rect math to agree for an overlay sized
          differently than the source chip it was picked up from. */}
      {activeDragData?.kind === "sticker-source" && pointerPos && (
        <div
          className="pointer-events-none fixed z-50 drop-shadow-[0_16px_28px_rgba(15,23,41,0.4)]"
          style={{
            left: pointerPos.x,
            top: pointerPos.y,
            // Baked straight into the transform string (not a Tailwind
            // class) since this element's transform is entirely owned
            // here — a class-based transform utility would just be
            // overwritten by this inline style anyway. The 1.15x scale is
            // the "picked up off the panel" feedback the brief asked for;
            // rotation comes from the scroll wheel (see ROTATE_SENSITIVITY
            // above).
            transform: `translate(-50%, -50%) rotate(${dragRotationDeg}deg) scale(1.15)`,
          }}
        >
          <Image
            src={profileStickerSrc(activeDragData.stickerKind as string) ?? ""}
            alt=""
            width={STICKER_SIZE}
            height={STICKER_SIZE}
            unoptimized
          />
        </div>
      )}

      {/* New-widget-from-palette preview: a fixed-size, grid-footprint-
          shaped preview centered on the cursor — for EVERY widget type,
          not just Listings. See dragPreviewSpec above for the sizing
          rule. This used to fall back to a plain text pill (via
          DragOverlay) for any type other than Listings, which was the
          "just shows the widget's name, 10 feet above the cursor" bug:
          DragOverlay's own rect math never reliably centered a pill sized
          differently from the palette chip it was dragged from, and a
          name isn't a preview of what you're about to place anyway.
          Favorite Card always renders with `favoriteCard={undefined}` here —
          a widget fresh off the palette has never had one picked yet. */}
      {activeDragData?.kind === "widget-source" && pointerPos && (
        <DragPreviewBox
          type={activeDragData.widgetType as string}
          favoriteCard={undefined}
          listings={listings}
          watchedIds={watchedIds}
          isLoggedIn={isLoggedIn}
          pointerPos={pointerPos}
          columnWidth={columnWidthRef.current}
        />
      )}

      {/* Already-placed-widget-being-repositioned preview: same
          fixed-size treatment as the palette-drag preview above,
          cursor-centered. FavoriteCardWidget is always passed `editable`
          (dragging an existing widget only ever happens during an
          owner's edit session in the first place) so an unconfigured
          Favorite Card still shows its real "search for a card"
          placeholder here instead of rendering nothing. */}
      {activeDragData?.kind === "widget-item" && draggingWidget && pointerPos && (
        <DragPreviewBox
          type={draggingWidget.type}
          favoriteCard={draggingFavoriteCard}
          listings={listings}
          watchedIds={watchedIds}
          isLoggedIn={isLoggedIn}
          pointerPos={pointerPos}
          columnWidth={columnWidthRef.current}
        />
      )}

      <WidgetTrashTarget activeDragKind={activeDragData?.kind as string | undefined} />
      <PaintUndoRedoDock engine={paintEngine} visible={paintArmed} />
    </DndContext>
  );
}

// Both useDroppable calls below (here and in WidgetStackDropZone) MUST
// live in a component rendered as an actual descendant of <DndContext> —
// not in ProfileEditor's own top-level body, even though ProfileEditor is
// the component that renders <DndContext>. React context is resolved by
// where a component sits in the tree, not by what JSX it later returns:
// a component can't consume a provider it renders as its own child.
// Confirmed via direct browser testing (dispatching real pointer events
// and logging dnd-kit's own collision-detection arguments) that this was
// a real, silent bug — useDroppable calls made directly in ProfileEditor
// were dispatching registration actions into the DEFAULT (no-op) context
// instead of the real one, so "widget-stack" and "widget-trash" never
// actually registered with dnd-kit at all, and the trash target could
// never resolve as "over" no matter how long or precisely the pointer
// sat on it. useSortable calls inside SortableWidget were never affected
// — that component genuinely is rendered as a descendant of DndContext's
// JSX (React calls its function while rendering DndContext's children),
// which is what made it easy to miss: some drag interactions on this
// canvas worked correctly while others, using what looked like the same
// APIs, silently didn't.
function WidgetTrashTarget({ activeDragKind }: { activeDragKind: string | undefined }) {
  const { setNodeRef, isOver } = useDroppable({ id: WIDGET_TRASH_ID });
  const { measureDroppableContainers } = useDndContext();
  const visible = activeDragKind === "widget-item" || activeDragKind === "widget-source";

  // dnd-kit only (re)measures a droppable's rect at drag start plus
  // whenever something explicitly asks it to — and this droppable's own
  // node only exists once `visible` turns true, mid-drag, well after that
  // initial measurement already happened. This is the same remeasure call
  // SortableContext makes internally for its own items whenever they
  // change; the trash isn't a sortable item, so nothing was doing that
  // for it.
  useEffect(() => {
    if (visible) measureDroppableContainers([WIDGET_TRASH_ID]);
  }, [visible, measureDroppableContainers]);

  if (!visible) return null;

  // Covers both a widget being pulled off the palette (dropping it here
  // is a "changed my mind, don't add it" gesture — the same outcome as
  // dropping it anywhere off-canvas already had, this just gives that
  // gesture a real, visible target) and an already-placed widget being
  // repositioned (dropping it here actually removes it — see
  // ProfileEditor's handleDragEnd — the same end result as its own
  // toolbar's × button, via drag instead). pointer-events-none
  // throughout: this is a pure visual drop target, dnd-kit resolves
  // "over" from measured rects, not native hover events, so it doesn't
  // need to intercept the pointer at all — and not intercepting it means
  // it can never accidentally steal the drag.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex flex-col items-center gap-2">
      <div
        ref={setNodeRef}
        className={`flex items-center justify-center rounded-full border-2 shadow-2xl transition-all duration-200 ${
          isOver
            ? "h-20 w-20 border-brand-urgent bg-brand-urgent text-white"
            : "h-16 w-16 border-white/15 bg-brand-navy/95 text-white/55 backdrop-blur"
        }`}
      >
        <Trash2 size={isOver ? 26 : 22} />
      </div>
      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold shadow transition-colors ${
          isOver ? "bg-brand-urgent text-white" : "bg-brand-navy/90 text-white/70"
        }`}
      >
        {isOver ? (activeDragKind === "widget-item" ? "Release to remove" : "Release to cancel") : "Drag here to remove"}
      </span>
    </div>
  );
}

// Same context-scoping reason as WidgetTrashTarget above — this has to be
// a real descendant of <DndContext>, not called directly in ProfileEditor.
function WidgetStackDropZone({
  children,
  stackOrderKey,
  widgetIds,
  widgetNodesRef,
}: {
  children: ReactNode;
  // The current arrangement (see ProfileEditor's own stackOrderKey) and
  // the real widget ids it's built from — together, what to remeasure and
  // when. See the remeasure effect below for why this is needed at all.
  stackOrderKey: string;
  widgetIds: string[];
  widgetNodesRef: React.RefObject<Map<string, HTMLDivElement>>;
}) {
  const { setNodeRef } = useDroppable({ id: "widget-stack" });
  const { measureDroppableContainers } = useDndContext();

  // dnd-kit only (re)measures a droppable's rect at drag start plus
  // whenever something explicitly asks it to — same fact that
  // WidgetTrashTarget's own remeasure effect is built on (see its
  // comment). That one covers the trash can, whose node doesn't exist
  // until a drag starts; this one covers something that mattered more in
  // practice: every *other* widget's droppable rect goes stale the moment
  // a reflow moves it. Confirmed via direct browser testing — drag a new
  // widget to insert it above Listings, then keep moving the cursor
  // toward Listings' new (lower) position: the insert-before/after split
  // kept comparing against Listings' ORIGINAL pre-reflow rect, because
  // nothing had told dnd-kit that rect was no longer where the DOM node
  // actually is.
  //
  // A naive "just call measureDroppableContainers on every stackOrderKey
  // change" doesn't work, though — confirmed by instrumented logging that
  // this was exactly why it still didn't work even with the call in
  // place: SortableWidget's own hand-rolled FLIP reflow (see its
  // useLayoutEffect) snaps a moved widget's *visual* position back to
  // where it used to be via a CSS transform the instant the reorder
  // commits, then animates that transform away to nothing over
  // WIDGET_REFLOW_MS. getBoundingClientRect() — what dnd-kit's own
  // remeasure reads — includes whatever transform is currently applied,
  // so a remeasure fired in the same tick as the reorder just captures
  // the widget's OLD position again, via a different mechanism than
  // before. Waiting out the animation would fix that but adds a
  // WIDGET_REFLOW_MS-wide window where a live-moving cursor gets stale
  // answers — not the "super dynamic" feel this is supposed to have.
  // Instead: momentarily clear each widget's own transform (if the FLIP
  // effect happens to have one in flight), measure, then restore it —
  // synchronously, same tick, so nothing actually paints in the
  // transform-cleared state. getBoundingClientRect() then reports the
  // TRUE settled layout position immediately, not after a wait.
  useEffect(() => {
    const nodes = widgetIds.map((id) => widgetNodesRef.current.get(id)).filter((el): el is HTMLDivElement => !!el);
    const prevTransforms = nodes.map((el) => el.style.transform);
    nodes.forEach((el) => {
      el.style.transform = "";
    });
    measureDroppableContainers(["widget-stack", ...widgetIds]);
    nodes.forEach((el, i) => {
      el.style.transform = prevTransforms[i];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackOrderKey, measureDroppableContainers]);

  return (
    <div ref={setNodeRef} className="grid min-h-[80px] grid-cols-3 gap-4 px-6 pb-7 pt-4 sm:px-7">
      {children}
    </div>
  );
}

function SortableWidget({
  widget,
  editable,
  listings,
  watchedIds,
  isLoggedIn,
  stackOrderKey,
  widgetNodesRef,
  onRemove,
  onFavoriteCardChange,
}: {
  widget: ProfileWidget;
  editable: boolean;
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  // The current arrangement, as a string (see ProfileEditor's own
  // stackOrderKey) — the reflow effect below depends on this, not on
  // "every render," so it only actually re-evaluates when the
  // arrangement changes.
  stackOrderKey: string;
  // Shared registry of every mounted widget's own DOM node, keyed by id —
  // see WidgetStackDropZone's remeasure effect for why it needs this.
  widgetNodesRef: React.RefObject<Map<string, HTMLDivElement>>;
  onRemove: () => void;
  onFavoriteCardChange: (card: FavoriteCardRef | null) => void;
}) {
  // transform/transition are deliberately not read from useSortable's
  // return at all — see the WIDGET_REFLOW_MS/EASING comment near the top
  // of this file for why (confirmed, via direct browser testing, that
  // dnd-kit's own FLIP-recovery math produces wrong scaleX/scaleY deltas
  // in this specific mixed-footprint grid). This hook is still used for
  // attributes/listeners/setNodeRef/isDragging, which all work correctly
  // — only its transform output is untrusted.
  // Confirmed via direct browser testing (dispatching real pointer events
  // and reading the committed order after drop) that leaving this
  // widget's own droppable registered WHILE it's the one being dragged
  // causes exactly the bug it looks like it would: as previewWidgets
  // repositions it during the drag, its own (still-registered) droppable
  // rect can end up closer to the pointer than the widget you're actually
  // trying to drop next to, so `pointerWithin` resolves `over` back to
  // itself — which handleDragMove's "hovering my own original slot" branch
  // then reads as "put it back where it started," silently reverting an
  // otherwise-correct-looking drag right before the final drop. Disabling
  // `droppable` specifically (not `draggable` — this widget still needs
  // to BE the drag source) while it's the live active id removes it from
  // collision consideration entirely, so `over` can only ever resolve to
  // an actual different widget (or the stack/trash) once a drag is under
  // way.
  const { active } = useDndContext();
  const isActiveDrag = active?.id === widget.id;
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: widget.id,
    data: { kind: "widget-item" },
    disabled: { draggable: !editable, droppable: !editable || isActiveDrag },
  });

  // Hand-rolled FLIP (First-Last-Invert-Play), translate-only: whenever
  // this widget's own on-screen position differs from where it was last
  // measured, instantly counter-offset it there (no transition) and, one
  // frame later, animate that offset back to zero (with a transition) —
  // the browser fills in the motion between old and new position.
  //
  // "Moving around like crazy" turned out to be TWO separate, compounding
  // bugs, both confirmed by directly logging every real trigger during a
  // live, dispatched drag (not just inspected in theory):
  //
  // 1) This effect had no dependency array, so it re-ran on every one of
  //    ProfileEditor's renders — including the ~60/sec renders triggered
  //    by pointerPos updating during ANY full-preview drag (see the
  //    window pointermove listener above), not just renders where this
  //    widget's position actually changed. Fixed by gating on
  //    [stackOrderKey, isDragging] — stackOrderKey is a string, stable
  //    across renders where the arrangement didn't change, so the effect
  //    now only fires when this widget's position could plausibly have
  //    moved. isDragging stays in the array too, so the post-drop "ease
  //    into final slot" case (below) still fires on a render where
  //    stackOrderKey didn't change.
  //
  // 2) Independently, reordering a widget moves it — and if the pointer
  //    happens to be hovering near the boundary that reorder just
  //    crossed, the widget's own new position can fall back outside the
  //    pointer's hover zone, reverting the reorder, moving the widget
  //    back, re-entering the hover zone, redoing the reorder — a genuine
  //    feedback loop. One logged trace showed 24 separate (correctly-
  //    sized, non-corrupted) reflow triggers alternating +136px/-136px
  //    within a single continuous drag. Fixed in ProfileEditor's
  //    commitDragOverIndex, not here — see DRAG_OVER_FLIP_HYSTERESIS_MS.
  //
  // A third, related bug (not oscillation, but runaway growth) is guarded
  // against below by using offsetTop/offsetLeft instead of
  // getBoundingClientRect for the position measurement.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const prevRectRef = useRef<{ top: number; left: number } | null>(null);
  function setRefs(el: HTMLDivElement | null) {
    nodeRef.current = el;
    setNodeRef(el);
    if (el) widgetNodesRef.current.set(widget.id, el);
    else widgetNodesRef.current.delete(widget.id);
  }
  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el || isDragging) return;
    // offsetTop/offsetLeft (position relative to offsetParent), not
    // getBoundingClientRect() — deliberately. getBoundingClientRect
    // returns the element's VISUAL box, which includes whatever CSS
    // transform happens to be applied at that exact moment; offsetTop/
    // offsetLeft reflect only true layout position and are completely
    // unaffected by transform. Confirmed via direct browser testing
    // (logging every real trigger's computed dx/dy) that using
    // getBoundingClientRect here was the actual cause of "moving around
    // like crazy": if this effect fired again before a PRIOR run's
    // requestAnimationFrame callback had cleared ITS OWN invert
    // transform, the next "current" measurement was corrupted by that
    // still-applied transform — and since the wrong delta computed from
    // it became the NEW transform (corrupting the measurement after
    // THAT the same way), the error compounded exponentially within a
    // single drag: logged dy values ran 124 → -258 → 382 → -504 → 750 →
    // -1254 → 2140 → ... → over 38,000px, alternating sign, all from one
    // continuous pointer drag. offsetTop/offsetLeft sidestep this
    // entirely since transform never touches them.
    const current = { top: el.offsetTop, left: el.offsetLeft };
    const prev = prevRectRef.current;
    if (prev && (prev.left !== current.left || prev.top !== current.top)) {
      const dx = prev.left - current.left;
      const dy = prev.top - current.top;
      el.style.transition = "none";
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${WIDGET_REFLOW_MS}ms ${WIDGET_REFLOW_EASING}`;
        el.style.transform = "";
      });
    }
    prevRectRef.current = current;
  }, [stackOrderKey, isDragging]);

  // Every widget type now always renders SOMETHING, for every viewer —
  // FavoriteCardWidget's own unconfigured state and EmptySpaceWidget's own
  // editable-gated placeholder both handle "nothing to show yet" on their
  // own (see WidgetRenderers.tsx); this never has to fall back to null for
  // a public visitor anymore, unlike before, where an unconfigured
  // Favorite Card quietly disappeared for anyone but its owner and left a
  // hole in the grid instead of reserving its cell.
  const content =
    widget.type === "listings" ? (
      <ListingsWidget listings={listings} watchedIds={watchedIds} isLoggedIn={isLoggedIn} />
    ) : widget.type === "favorite_card" ? (
      <FavoriteCardWidget card={widget.favoriteCard} editable={editable} />
    ) : widget.type === "empty_space" ? (
      <EmptySpaceWidget editable={editable} />
    ) : null;

  // The grid column span AND start have to be applied here, on the actual
  // grid item, in both the editable and read-only paths below — a visitor
  // never sees the editable branch, so if only that one carried them,
  // Listings would silently collapse to a single 1/3-width cell, and a
  // 1-column widget dropped in column 2 or 3 would silently snap back to
  // column 1, for every real viewer of the profile while still looking
  // right to the owner mid-edit.
  // Plain widgetColSpan/widgetGridColumnStyle at all times, including
  // while actively being repositioned — an earlier version forced a
  // 1-column widget to col-span-3 while dragging, to make room for a
  // "show all 3 columns of the row" picker (ThreeSlotRow, since removed).
  // That was a real, reported layout bug, not just a style choice: it made
  // the widget currently being dragged always claim its entire row for
  // itself, which pushed any OTHER 1-column widget already sharing that
  // row down to a new row — e.g. repositioning Empty Space into column 2
  // of Favorite Card's row (column 1) genuinely couldn't land there,
  // because the drag briefly ate the whole row. Keeping the normal
  // col-span-1 + explicit column throughout means the in-place placeholder
  // below shares a row with its neighbors exactly like the settled widget
  // does — see ColumnGhost's own comment for the equivalent fix on the
  // new-from-palette side of this.
  const colSpanClass = widgetColSpan(widget.type);
  const gridColumnStyle = widgetGridColumnStyle(widget);

  // Every widget renders inside the same card shell the rest of the site
  // already uses for content surfaces (rounded-2xl/border-brand-border/
  // bg-white/shadow-sm — see e.g. app/account/withdraw's panel), so a
  // widget reads as a real, finished piece of UI sitting on the canvas
  // rather than bare content floating on the backdrop. Empty Space and
  // Favorite Card both skip it, in EDIT mode too, not just for a visitor:
  // Empty Space because a solid white card would hide whatever the owner
  // just painted into that reserved area (the paint layer is behind every
  // widget), and Favorite Card by explicit design — it's meant to read as
  // just the card art sitting directly on the canvas, not a card inside
  // another card, so its background has to stay fully transparent too.
  // Both widgets' own two states (blank/nothing for a visitor, a faint
  // dashed placeholder while arranging) already account for both cases
  // here.
  if (!editable) {
    return (
      <div className={colSpanClass} style={gridColumnStyle}>
        {widget.type === "empty_space" || widget.type === "favorite_card" ? content : content && <WidgetShell>{content}</WidgetShell>}
      </div>
    );
  }

  const label = WIDGET_CATALOG.find((c) => c.type === widget.type)?.label ?? widget.type;

  return (
    // relative + an absolutely-positioned toolbar, not a normal-flow row
    // above `content` — a row here would make the widget (and therefore
    // the whole canvas) taller while editing than once you exit, and since
    // stickers are positioned as a percentage of the canvas's height, that
    // extra height is exactly what was shifting every sticker up the
    // moment the toolbars disappeared. Floating the toolbar over the
    // content instead means this widget's box is the same height in both
    // states — `content` renders identically either way, only the little
    // pill on top of it comes and goes.
    <div
      ref={setRefs}
      style={gridColumnStyle}
      className={`pointer-events-auto relative ${colSpanClass} ${isDragging ? "z-30" : ""}`}
    >
      <div
        className={`pointer-events-auto absolute -top-3.5 left-3 z-10 flex items-center gap-2 rounded-full bg-brand-navy px-2.5 py-1.5 text-xs text-white shadow-[0_4px_12px_rgba(15,23,41,0.3)] ring-1 ring-white/10 ${
          isDragging ? "ring-2 ring-brand-gold/70" : ""
        }`}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="touch-none text-white/40 hover:text-white"
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
        <span className="font-semibold tracking-wide text-white/90">{label}</span>
        {widget.type === "favorite_card" && (
          <FavoriteCardPicker
            current={widget.favoriteCard}
            onSelect={(card) =>
              onFavoriteCardChange({
                id: card.id,
                game: card.game,
                name: card.name,
                setName: card.setName,
                number: card.number,
                rarity: card.rarity,
                imageUrl: card.imageUrl,
              })
            }
            onClear={() => onFavoriteCardChange(null)}
          />
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="ml-auto text-white/40 hover:text-red-300"
          aria-label={`Remove ${label}`}
        >
          <X size={14} />
        </button>
      </div>
      {isDragging ? (
        // A calm "here's where it came from" placeholder, not the real
        // content — the actual cursor-following visual is the floating
        // preview near the end of ProfileEditor, and this node's own
        // transform is deliberately never touched while dragging (see
        // above), so rendering the real content here risks it looking
        // static-but-wrong rather than intentionally out of the way. Plain
        // col-span-1 box (no ThreeSlotRow full-row takeover — see the
        // colSpanClass comment above for why that was a real bug, not
        // just unnecessary here).
        <div className="flex h-full min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-brand-border bg-brand-surface/60" />
      ) : widget.type === "empty_space" || widget.type === "favorite_card" ? (
        content
      ) : (
        <WidgetShell>{content}</WidgetShell>
      )}
    </div>
  );
}

// The shared "real piece of UI" card frame every widget renders inside —
// same visual idiom as the rest of the site's content cards (rounded-2xl,
// border-brand-border, bg-white, shadow-sm), so a widget on the profile
// canvas reads as belonging to AuctionHous rather than a generic dashboard
// tile. A quiet hover lift (shadow only — no transform, so it never fights
// dnd-kit's own transform on the parent sortable node) is the one bit of
// polish layered on top.
function WidgetShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full rounded-2xl border border-brand-border bg-white p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6">
      {children}
    </div>
  );
}

// The floating, cursor-following drag preview — see dragPreviewSpec above
// for the sizing rule. `overflow-hidden` on the OUTER, explicitly-sized
// box is what actually enforces that rule: the inner div renders the real
// widget at its natural ("virtual") width and gets scaled down with a
// plain CSS transform, but a transform never changes the space a box
// claims from its parent's layout — without an outer box with a fixed
// height clipping it, the preview's true height would still be whatever
// the unscaled content's real height happens to be, no matter how small
// the content looks. Deliberately not built on WidgetShell (its padding
// would eat into the exact pixel target this needs to hit).
function DragPreviewBox({
  type,
  favoriteCard,
  listings,
  watchedIds,
  isLoggedIn,
  pointerPos,
  columnWidth,
}: {
  type: string;
  favoriteCard: FavoriteCardRef | null | undefined;
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  pointerPos: { x: number; y: number };
  // The real, live-measured single-column width (see columnWidthRef) —
  // threaded in rather than read from a module constant so the preview
  // always matches the canvas's actual current rendered width.
  columnWidth: number;
}) {
  const { width, height, virtualWidth } = dragPreviewSpec(type, columnWidth);
  const scale = width / virtualWidth;
  return (
    <div
      className="pointer-events-none fixed z-50 overflow-hidden rounded-2xl border border-brand-border bg-white opacity-90 shadow-2xl"
      style={{
        left: pointerPos.x,
        top: pointerPos.y,
        width,
        height,
        transform: "translate(-50%, -50%)",
      }}
    >
      {type === "empty_space" || type === "favorite_card" ? (
        // Neither has any internal content that needs proportional
        // scaling (Empty Space is just a dashed box at a fixed height;
        // Favorite Card is just an image already capped/centered within
        // its own fixed-height box) — render directly at the outer box's
        // real width/height instead of going through the virtualWidth/
        // scale trick below. That trick scales EVERYTHING inside the
        // wrapper, including these widgets' own explicit WIDGET_1COL_HEIGHT
        // inline heights, which would inflate them past the outer box's
        // actual (correct) height and get clipped by overflow-hidden.
        <div style={{ width, height }}>
          {type === "empty_space" ? <EmptySpaceWidget editable /> : <FavoriteCardWidget card={favoriteCard} editable />}
        </div>
      ) : (
        <div className="pointer-events-none origin-top-left" style={{ width: virtualWidth, transform: `scale(${scale})` }}>
          <ListingsWidget listings={listings} watchedIds={watchedIds} isLoggedIn={isLoggedIn} />
        </div>
      )}
    </div>
  );
}

