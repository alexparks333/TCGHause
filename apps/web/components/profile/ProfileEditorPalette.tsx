"use client";

import { useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Image from "next/image";
import {
  X,
  Sparkles,
  LayoutGrid,
  GripVertical,
  Star,
  SquareDashed,
  Check,
  CircleDot,
  MousePointer2,
} from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { MAX_WIDGETS, PROFILE_STICKER_OPTIONS, WIDGET_CATALOG, type Listing } from "@/lib/types";
import { MAX_STICKERS } from "./StickerBoard";
import { ListingsWidget } from "./WidgetRenderers";
import PaintToolbar from "./paint/PaintToolbar";
import { type PaintEngine } from "./paint/usePaintEngine";

// One small glyph per catalog widget type, purely decorative (identity at
// a glance in the tool panel) — "listings" doesn't need one, it already
// gets a genuine live-preview thumbnail (see ListingsWidgetChip) instead
// of an icon+label chip.
const WIDGET_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  favorite_card: Star,
  empty_space: SquareDashed,
};

type Tab = "widgets" | "background";
const PANEL_MARGIN = 8;
// The mini live preview renders the real ListingsWidget as if the canvas
// were this wide, then scales the whole thing down to fit the panel's
// content column — a genuine (if approximate) snapshot of the widget's
// real grid/card look, not a mocked-up thumbnail. 896px is a reasonable
// stand-in for a typical desktop canvas width; this is a "temporary
// look" preview (see the drag/drop-size preview in ProfileEditor.tsx for
// the pixel-accurate version). 256 = the panel's own content column width:
// w-72 (288px) minus the p-4 content area's 16px of horizontal padding on
// each side.
const PREVIEW_VIRTUAL_WIDTH = 896;
const PREVIEW_COLUMN_WIDTH = 256;
const PREVIEW_SCALE = PREVIEW_COLUMN_WIDTH / PREVIEW_VIRTUAL_WIDTH;

// The docked, Photoshop-style tool panel for the profile canvas editor
// (ProfileEditor.tsx). Floats over the page rather than dimming it, and —
// per product direction — is purely a source of things to drag onto the
// canvas, not a list of controls that act on the canvas from a distance.
// Every chip here is a dnd-kit useDraggable source; ProfileEditor's shared
// DndContext (it wraps this panel and the canvas together) is what turns a
// drop into an actual sticker placement or widget insertion — this
// component never mutates state directly.
export default function ProfileEditorPalette({
  widgetCount,
  stickerCount,
  listings,
  watchedIds,
  isLoggedIn,
  dirty,
  saving,
  error,
  paintEngine,
  recentColors,
  onPickRecentColor,
  onSave,
  onCancel,
  onDone,
}: {
  // Total placed widgets — mirrors stickerCount's own role below. Every
  // catalog entry can be placed any number of times (no per-type cap), so
  // this overall count against MAX_WIDGETS is the only thing that ever
  // disables a chip.
  widgetCount: number;
  stickerCount: number;
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  dirty: boolean;
  saving: boolean;
  error: string;
  // The shared paint engine (owned by ProfileEditor, same instance
  // PaintLayer draws with) — the Background tab's PaintToolbar is a set
  // of controls over it, not its own state.
  paintEngine: PaintEngine;
  recentColors: string[];
  onPickRecentColor: (hex: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<Tab>("widgets");
  const atWidgetCap = widgetCount >= MAX_WIDGETS;

  // Panel position — null means "use the default docked spot" (the
  // left-4/top-24 classes below); once dragged, it switches to explicit
  // left/top coordinates so the panel can be parked anywhere on screen
  // while customizing. Plain pointer-capture dragging, not dnd-kit — this
  // is a UI window being repositioned, not something being dropped onto
  // the canvas, so it doesn't need to share DndContext's drag/drop
  // semantics, only coexist with it (which a plain onPointerDown does,
  // since dnd-kit only listens on the specific nodes its own
  // useDraggable/useSortable hooks are attached to).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);

  function handleHeaderPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!panelRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = panelRef.current.getBoundingClientRect();
    dragOrigin.current = { pointerX: e.clientX, pointerY: e.clientY, left: rect.left, top: rect.top };
  }

  function handleHeaderPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragOrigin.current || !panelRef.current) return;
    const { pointerX, pointerY, left, top } = dragOrigin.current;
    const w = panelRef.current.offsetWidth;
    const h = panelRef.current.offsetHeight;
    const nextLeft = Math.min(Math.max(left + (e.clientX - pointerX), PANEL_MARGIN), window.innerWidth - w - PANEL_MARGIN);
    const nextTop = Math.min(Math.max(top + (e.clientY - pointerY), PANEL_MARGIN), window.innerHeight - h - PANEL_MARGIN);
    setPos({ left: nextLeft, top: nextTop });
  }

  function handleHeaderPointerUp() {
    dragOrigin.current = null;
  }

  return (
    <div
      ref={panelRef}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      className={`fixed z-40 flex max-h-[80vh] w-72 flex-col overflow-hidden rounded-[20px] border border-black/10 bg-white shadow-[0_2px_8px_rgba(15,23,41,0.08),0_24px_48px_-16px_rgba(15,23,41,0.35)] ring-1 ring-black/5 ${
        pos ? "" : "left-4 top-24"
      }`}
    >
      {/* A toolbox, not a settings form — the navy chrome + gold grip
          mirrors the widget-card toolbar (SortableWidget) so the whole
          editing surface reads as one consistent "tool" language rather
          than a plain white admin card. */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        className="flex touch-none cursor-grab items-center justify-between gap-2 bg-gradient-to-b from-brand-navy-light to-brand-navy px-4 py-3.5 active:cursor-grabbing"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-white">
          <GripVertical size={15} className="text-white/30" />
          Edit Profile
        </span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onDone}
          className="flex h-6 w-6 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="Close editor"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex gap-1 bg-brand-surface p-1.5">
        <button
          type="button"
          // Leaving the Background tab disarms painting — the Widgets tab
          // is about arranging, and an invisibly-armed brush over the
          // whole canvas would make widget drags impossible to start.
          onClick={() => {
            setTab("widgets");
            paintEngine.setTool("arrange");
          }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
            tab === "widgets" ? "bg-white text-brand-navy shadow-sm" : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <LayoutGrid size={13} /> Widgets
        </button>
        <button
          type="button"
          onClick={() => setTab("background")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
            tab === "background" ? "bg-white text-brand-navy shadow-sm" : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <Sparkles size={13} /> Background
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "widgets" ? (
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
              <MousePointer2 size={11} /> Drag onto your profile
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {WIDGET_CATALOG.map((c) =>
                c.type === "listings" ? (
                  <ListingsWidgetChip
                    key={c.type}
                    listings={listings}
                    watchedIds={watchedIds}
                    isLoggedIn={isLoggedIn}
                    disabled={atWidgetCap}
                  />
                ) : (
                  <WidgetChip key={c.type} type={c.type} label={c.label} description={c.description} disabled={atWidgetCap} />
                ),
              )}
              {atWidgetCap && (
                <p className="text-[11px] text-gray-400">
                  You've reached the {MAX_WIDGETS}-widget limit — remove one to add another.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
                <MousePointer2 size={11} /> Drag a sticker onto your profile
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PROFILE_STICKER_OPTIONS.map((opt) => (
                  <StickerChip
                    key={opt.kind}
                    kind={opt.kind}
                    label={opt.label}
                    src={opt.src}
                    disabled={stickerCount >= MAX_STICKERS}
                  />
                ))}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-surface">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-gold to-brand-gold-light transition-[width]"
                    style={{ width: `${Math.min(100, (stickerCount / MAX_STICKERS) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] tabular-nums text-gray-400">
                  {stickerCount}/{MAX_STICKERS}
                </span>
              </div>
            </div>

            <PaintToolbar engine={paintEngine} recentColors={recentColors} onPickRecent={onPickRecentColor} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-brand-border px-4 py-3">
        {dirty ? (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-b from-brand-gold-light to-brand-gold px-4 py-2 text-xs font-semibold text-white shadow-[0_2px_6px_rgba(184,134,11,0.4)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(184,134,11,0.5)] disabled:translate-y-0 disabled:opacity-60 disabled:shadow-none"
            >
              <Check size={13} />
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:underline">
              Cancel
            </button>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
              <CircleDot size={10} className="animate-canvas-hint-pulse text-brand-gold" />
              Unsaved
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <Check size={13} className="text-brand-success" /> All changes saved
          </span>
        )}
      </div>
      {error && <p className="border-t border-brand-border px-4 py-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}

// Shared chrome for both chip types below — an iOS-widget-gallery-style
// "gallery card" (a visual well on top, a name+description footer below),
// so Favorite Card's icon-only chip and Listings' live-preview chip read
// as one consistent picker instead of two different chip languages. The
// grip glyph that fades in over the visual on hover isn't functional (the
// whole card is the drag handle, same as before) — it's a hover-only cue
// that this card actually picks up and moves, since it no longer looks
// like a plain list row now that it has real visual weight.
function WidgetGalleryCard({
  isDragging,
  disabled,
  title,
  ariaLabel,
  visual,
  label,
  description,
  dragHandleProps,
  setNodeRef,
}: {
  isDragging: boolean;
  // At the overall maxWidgets cap — the chip stays visible (so it's
  // obvious the type still exists / why it disappeared isn't a mystery)
  // but can't be picked up, same "dim + not-allowed cursor" treatment
  // StickerChip already uses for the analogous MAX_STICKERS cap.
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  visual: ReactNode;
  label: string;
  description: string;
  dragHandleProps: Record<string, unknown>;
  setNodeRef: (node: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={setNodeRef}
      {...dragHandleProps}
      title={title}
      aria-label={ariaLabel}
      className={`group touch-none overflow-hidden rounded-xl border border-brand-border bg-white transition-all ${
        disabled
          ? "cursor-not-allowed opacity-40"
          : `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-30" : "hover:-translate-y-0.5 hover:border-brand-gold/40 hover:shadow-md"}`
      }`}
    >
      <div className="relative h-24 w-full overflow-hidden bg-gradient-to-br from-brand-navy to-brand-navy-light">
        {visual}
        <GripVertical
          size={14}
          className="absolute right-2 top-2 text-white/40 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
      <div className="px-3 py-2.5 text-left text-xs">
        <span className="block font-semibold text-gray-900">{label}</span>
        <span className="block text-gray-400">{description}</span>
      </div>
    </div>
  );
}

// A drag SOURCE, not a button with an onClick — picking it up and dropping
// it on the canvas (ProfileEditor's DndContext) is what actually adds it.
// It stays put in the panel while dragging (opacity dims it); the floating
// copy the cursor carries is ProfileEditor's DragOverlay.
function WidgetChip({
  type,
  label,
  description,
  disabled,
}: {
  type: string;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-widget-${type}`,
    data: { kind: "widget-source", widgetType: type },
    disabled,
  });
  const Icon = WIDGET_ICONS[type] ?? LayoutGrid;

  return (
    <WidgetGalleryCard
      isDragging={isDragging}
      disabled={disabled}
      setNodeRef={setNodeRef}
      dragHandleProps={{ ...attributes, ...listeners }}
      label={label}
      description={description}
      visual={
        <div className="flex h-full items-center justify-center">
          <Icon size={28} className="text-brand-gold-light" />
        </div>
      }
    />
  );
}

// The Listings catalog entry's drag source — a genuine miniature live
// preview (the real ListingsWidget, scaled down to fit) instead of an
// icon, so you see roughly what you're about to add before you even pick
// it up. See ProfileEditor.tsx for the pixel-accurate, full-size preview
// that takes over once you actually start dragging.
function ListingsWidgetChip({
  listings,
  watchedIds,
  isLoggedIn,
  disabled,
}: {
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: "palette-widget-listings",
    data: { kind: "widget-source", widgetType: "listings" },
    disabled,
  });
  const description = WIDGET_CATALOG.find((c) => c.type === "listings")?.description ?? "";

  return (
    <WidgetGalleryCard
      isDragging={isDragging}
      disabled={disabled}
      setNodeRef={setNodeRef}
      dragHandleProps={{ ...attributes, ...listeners }}
      title="Listings"
      ariaLabel="Listings"
      label="Listings"
      description={description}
      visual={
        <div className="absolute inset-0 bg-brand-surface">
          <div
            className="pointer-events-none origin-top-left"
            style={{ width: PREVIEW_VIRTUAL_WIDTH, transform: `scale(${PREVIEW_SCALE})` }}
          >
            <ListingsWidget listings={listings} watchedIds={watchedIds} isLoggedIn={isLoggedIn} />
          </div>
        </div>
      }
    />
  );
}

function StickerChip({
  kind,
  label,
  src,
  disabled,
}: {
  kind: string;
  label: string;
  src: string;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-sticker-${kind}`,
    data: { kind: "sticker-source", stickerKind: kind },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={label}
      aria-label={label}
      // No box — just the sticker art itself, sized up so it reads as a
      // real preview of what you're about to place, not a UI chip. The
      // hover/drag feedback lives on the image (scale/opacity), not a
      // background or border, so there's still nothing but the sticker.
      className={`flex touch-none aspect-square items-center justify-center ${
        disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <Image
        src={src}
        alt={label}
        width={72}
        height={72}
        unoptimized
        className={`transition-all duration-200 ${
          disabled ? "opacity-40" : "hover:scale-110 hover:drop-shadow-[0_8px_18px_rgba(184,134,11,0.45)]"
        } ${isDragging ? "opacity-30" : ""}`}
      />
    </div>
  );
}
