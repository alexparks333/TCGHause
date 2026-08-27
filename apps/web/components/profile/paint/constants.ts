// The paint bitmap's fixed, device-independent width in pixels. The profile
// canvas container is fluid (w-full page, no max-width — see
// app/seller/[username]/page.tsx), so this is a chosen constant, not derived
// from layout: every stroke is mapped from CSS coordinates into this fixed
// width (scale = PAINT_DESIGN_WIDTH / container CSS width), and the bitmap
// renders back at CSS width:100% / height:auto. That makes the artwork
// viewport-independent the same way stickers' xPct is.
//
// 2x a typical rendered container width (was 1440, tuned for a ~1300-1400px
// desktop canvas at 1x) — the earlier value read as soft/blurry on any
// high-DPI (retina) display, where a CSS pixel is 2+ *device* pixels: with
// only ~1 bitmap pixel per CSS pixel, the browser was upsampling the
// artwork to fill the screen. 2880 gives ~2 bitmap pixels per CSS pixel at
// a typical width, which is sharp on 2x displays and still fine on 1x
// (mild, imperceptible supersampling). Brush size constants below are
// scaled up to match, so a given size slider value still looks the same
// physical thickness on screen as it did at the old resolution.
export const PAINT_DESIGN_WIDTH = 2880;

// Mirrors apps/api/internal/user.maxCanvasHeightPx (and maxStickerYPx —
// both describe the same content-driven canvas), halved from that 20000
// ceiling to hold the same worst-case bitmap byte size (width * height * 4)
// now that PAINT_DESIGN_WIDTH doubled — still enormously generous (10000
// bitmap rows is thousands of CSS pixels of scrollable widget stack). The
// bitmap only ever GROWS in height (new pixel rows appended as widgets
// extend the page, never a rescale of existing pixels — see
// usePaintEngine's growTo); this is the hard ceiling so a pathological
// widget stack can't allocate a gigantic buffer client-side.
export const PAINT_MAX_HEIGHT = 10000;

// Brush size bounds (bitmap pixels, so a stroke's stored thickness is
// viewport-independent too) — doubled alongside PAINT_DESIGN_WIDTH so the
// same slider value still renders at the same on-screen thickness as
// before the resolution bump.
export const PAINT_MIN_BRUSH = 4;
export const PAINT_MAX_BRUSH = 160;
export const PAINT_DEFAULT_BRUSH = 20;

export const PAINT_DEFAULT_COLOR = "#b8860b"; // brand gold

// Spray can only: how far dots scatter from the pointer, independent of
// the shared Size slider above (which drives individual DOT size for
// spray, same as it drives stroke width for every other tool). These used
// to be the same one number — bigger size meant both a wider cloud AND
// bigger dots AND (since density scaled with that same radius squared)
// much denser coverage, all compounding together into what read as a
// solid marker-like blob rather than an airy spray. Splitting them out
// lets "make the cloud wider" and "make the flecks bigger" move
// independently, matching a real can (nozzle size vs. distance from the
// surface). Bitmap px, same units as brush size.
export const PAINT_MIN_SPREAD = 10;
export const PAINT_MAX_SPREAD = 320;
export const PAINT_DEFAULT_SPREAD = 60;

// Region-based undo keeps entries small (a stroke's own bounding box, not
// the whole bitmap), so this cap bounds memory rather than usefulness.
export const PAINT_UNDO_LIMIT = 15;

export const PAINT_RECENT_COLORS_LIMIT = 8;

// "arrange" is the non-painting mode — stickers/widgets stay interactive
// and the paint canvas ignores the pointer entirely. Every other value
// arms the canvas (pointer-events flip to it, see PaintLayer).
export type PaintTool =
  | "arrange"
  | "pen"
  | "marker"
  | "calligraphy"
  | "spray"
  | "fill"
  | "eyedropper"
  | "eraser";

// Tools with no meaningful brush-size cursor — fill picks a target region,
// not a stroke width, and the eyedropper samples a single pixel. Shared by
// PaintLayer (which CSS cursor to show) and BrushCursor (whether to render
// the size/shape indicator at all) so the two can't disagree.
export const PAINT_TOOLS_WITHOUT_SIZE_CURSOR = new Set<PaintTool>(["fill", "eyedropper"]);
