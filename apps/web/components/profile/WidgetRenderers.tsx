"use client";

import { SquareDashed, Star } from "lucide-react";
import ListingSection from "@/components/ListingSection";
import { type Listing } from "@/lib/types";
import { type FavoriteCardRef } from "@/lib/api";

// The actual "what does this widget look like" renderers — pulled into
// their own module (not defined inside ProfileEditor.tsx) specifically so
// ProfileEditorPalette can import the exact same component for its
// miniature live preview and full-size drag-preview. ProfileEditor already
// imports ProfileEditorPalette, so ProfileEditorPalette importing back from
// ProfileEditor would be a cycle; this file has no opinion about the
// editor at all, just "given this data, render the widget", so both sides
// can depend on it.

// The exact same component every homepage row (Ending Soon, Buy It Now) is
// built from — a titled grid section with a "View all" link. Reusing it
// directly, not re-implementing its look, is what makes this widget
// actually match the rest of the site instead of just resembling it.
export function ListingsWidget({
  listings,
  watchedIds,
  isLoggedIn,
  currentUserId,
}: {
  listings: Listing[];
  watchedIds: Set<string>;
  isLoggedIn: boolean;
  // See ListingCard's own doc comment — without this, a seller viewing
  // their own public profile would see Buy It Now/Make an Offer on their
  // own listings here.
  currentUserId?: string;
}) {
  if (listings.length === 0) {
    // Same header ListingSection itself would render — without it, an
    // empty widget looked like nothing more than a stray line of gray
    // text, easy to mistake for the widget not having rendered at all
    // rather than a real (if currently empty) section.
    return (
      <div>
        <h2 className="mb-3 text-lg font-bold text-gray-900">Listings</h2>
        <p className="text-sm text-gray-500">No active listings.</p>
      </div>
    );
  }
  return (
    <ListingSection
      title="Listings"
      items={listings}
      watchedIds={watchedIds}
      isLoggedIn={isLoggedIn}
      currentUserId={currentUserId}
    />
  );
}

// The card image's own max width — kept well inside the ~413px grid
// column so a tall/narrow card never bumps the column's real width, and so
// the art reads at roughly the same size as a ListingCard inside the
// Listings widget rather than dominating its cell.
// Exported so ProfileEditor.tsx's floating drag preview can size its
// outer shell to match.
export const FAVORITE_CARD_MAX_WIDTH = 240;

// Just the card — no title, no price, no surrounding white card shell.
// SortableWidget skips WidgetShell entirely for this type (same as
// EmptySpaceWidget below) so the widget's background is the canvas itself,
// fully see-through around the art. The outer box is always exactly
// WIDGET_1COL_HEIGHT tall regardless of configured state, so picking (or
// changing) a card never shifts anything else on the canvas — only the
// content centered inside that fixed box changes.
export function FavoriteCardWidget({
  card,
  editable = false,
}: {
  // A picked catalog card snapshot (FavoriteCardRef, off the saved
  // widget) or a live CatalogCard (mid-search, from the picker) — both
  // shapes carry the same name/imageUrl/etc. fields this only ever reads.
  card: FavoriteCardRef | null | undefined;
  // Only ever true during an owner's edit session — gates the "search for
  // a card" placeholder below. A public visitor (or a settled, unconfigured
  // widget in view mode) gets nothing at all, same as EmptySpaceWidget: an
  // unpicked slot reserves its grid cell but has no chrome of its own to
  // show a stranger.
  editable?: boolean;
}) {
  if (!card) {
    if (!editable) {
      return <div style={{ height: WIDGET_1COL_HEIGHT }} />;
    }
    return (
      <div style={{ height: WIDGET_1COL_HEIGHT }} className="flex items-center justify-center">
        <div
          className="mx-auto flex aspect-[5/7] w-full max-w-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-border/50 px-4 text-center"
          style={{ maxHeight: WIDGET_1COL_HEIGHT }}
        >
          <Star size={20} className="text-gray-300/70" />
          <p className="text-xs text-gray-400">Search for a card to feature it here.</p>
        </div>
      </div>
    );
  }
  return (
    <div style={{ height: WIDGET_1COL_HEIGHT }} className="flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote,
          externally-hosted catalog art (TCG Haven's Firestore/Storage),
          same reasoning as CardSearch.tsx's own result thumbnails. */}
      <img
        src={card.imageUrl}
        alt={card.name}
        // A thin white "mat" around the art, not just a shadow — reads as
        // a framed card sitting on the canvas rather than art pasted
        // directly onto whatever's painted behind it, especially over a
        // dark or busy background.
        className="max-h-full w-auto rounded-xl border-[6px] border-white object-contain shadow-md"
        style={{ maxWidth: FAVORITE_CARD_MAX_WIDTH }}
      />
    </div>
  );
}

// Matches FavoriteCardWidget's own unconfigured-placeholder footprint
// exactly (measured live: 378px of inner content + WidgetShell's own 24px
// top/bottom padding at the sm+ breakpoint = 428px total) — Empty Space
// skips WidgetShell entirely (see below), so it has to carry that same
// total height itself, or a row mixing it with Favorite Card would look
// like two different-sized bricks instead of a uniform 1x1 grid. Every
// 1-column widget is meant to occupy the exact same footprint regardless
// of which one it is — this is the one shared reference size they all
// measure against today.
// Exported so ProfileEditor.tsx's floating drag-preview (DragPreviewBox)
// can size itself to match this exactly too — a repositioned widget's
// cursor-following preview used to be a fixed 150x150 box regardless of
// the real cell size, which read as "the widget shrinks" against an
// actual ~413px-wide, 428px-tall grid cell.
export const WIDGET_1COL_HEIGHT = 428;

// A blank 1x1 spacer — no listing to pick, no content to configure, just
// intentional breathing room the seller dragged into a specific grid cell,
// most often so they can paint directly into that reserved area (the paint
// layer sits BEHIND every widget) without a real widget's content getting
// in the way. That's why this is deliberately near-invisible in BOTH
// states, not just when a stranger views the finished profile: a solid
// card here — even just while the owner is arranging widgets — would sit
// on top of and hide whatever they just painted underneath it, defeating
// the entire reason to reach for a spacer instead of just leaving a gap
// unfilled. Skips WidgetShell's white card background entirely (see the
// shell-skip in SortableWidget) rather than rendering an empty white box;
// a faint dashed outline is the only visual while editing, purely so the
// cell is still findable/grabbable/removable, and even that disappears
// once it's not being arranged.
export function EmptySpaceWidget({ editable = false }: { editable?: boolean }) {
  if (!editable) {
    return <div style={{ height: WIDGET_1COL_HEIGHT }} />;
  }
  return (
    <div
      style={{ height: WIDGET_1COL_HEIGHT }}
      className="flex items-center justify-center rounded-xl border-2 border-dashed border-brand-border/50"
    >
      <SquareDashed size={16} className="text-gray-300/70" />
    </div>
  );
}
