"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Heart,
  Zap,
  Gavel,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Mail,
  Package,
  Truck,
  MoreVertical,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import ListingImage from "./ListingImage";
import BuyNowButton from "./BuyNowButton";
import MakeOfferButton from "./MakeOfferButton";
import StarRating from "./StarRating";
import { apiFetch, cancelListing, ApiError } from "@/lib/api";
import {
  type Listing,
  type MyBid,
  type ShippingPreset,
  type EndListingAction,
  type EndListingReason,
  END_LISTING_REASON_LABELS,
  formatPrice,
  formatMsLeft,
  formatSellerTier,
  listingSoldAt,
  sellerTierIconSrc,
  shippingBadge,
} from "@/lib/types";

// Mirrors apps/api/internal/auction.endEarlyCutoff exactly — real eBay's
// own hard stop, past which an auction with a bid can no longer be ended
// early at all (docs/EditListing.md). Checked client-side purely for a
// better confirm-dialog UX (showing the blocked state instead of a
// generic error after a failed attempt); the backend is still the real
// authority if this clock is ever stale by the time the request lands.
const END_EARLY_CUTOFF_MS = 12 * 60 * 60 * 1000;

// The physical container a listing ships in — envelope-based presets share
// Mail, box/bubble-mailer presets share Package, and shippo_ground_advantage
// (a real tracked parcel, not an envelope) gets Truck. Kept here rather than
// in lib/types.ts since that module is otherwise plain data/string helpers,
// no React/lucide imports.
const SHIPPING_PRESET_ICONS: Record<ShippingPreset, typeof Mail> = {
  free_envelope: Mail,
  tracked_envelope: Mail,
  free_bubble_mailer: Package,
  free_box: Package,
  shippo_ground_advantage: Truck,
};
import { formatDateTime, formatCompactCount } from "@/lib/format";
import { useMsLeft } from "@/lib/useMsLeft";
import { usePokeCelebrations } from "./CelebrationWatcher";

const RIBBON_MS = 1600;
const COLLAPSE_MS = 350;

// How far (as a % of the card's own width) a non-current photo sits from
// dead center — purely to give the slide-out/slide-in motion somewhere to
// travel from/to while it fades. Unlike ListingRow's search-results
// carousel, nothing here ever sits at a nonzero opacity at rest — no
// tucked-behind "ghost" peek of the next photo, per product decision (this
// card is small enough that a peek would just look cramped). Only the
// current photo (offset 0) is ever visible; every other offset is
// invisible both before and after the transition, so the only thing
// that's ever seen is the transition itself: the outgoing photo sliding
// out while fading, the incoming one sliding in while fading up.
const CAROUSEL_SHIFT_PCT = 35;

type EndPhase = "live" | "ribbon" | "collapsing";

export default function ListingCard({
  listing,
  initialWatching = false,
  isLoggedIn = false,
  currentUserId,
  myBid,
  removeOnEnd = false,
  onEnded,
  hideSellerFooter = false,
  hideActions = false,
  ownerMenu = false,
  ownerMenuReadOnly = false,
}: {
  listing: Listing;
  initialWatching?: boolean;
  isLoggedIn?: boolean;
  // The signed-in viewer's own id, if any — compared against listing.
  // sellerId and threaded into MakeOfferButton as isOwnListing. Buy It Now/
  // Make an Offer stay visible and clickable even on the viewer's own
  // listing (product decision — not hidden the way the detail page's
  // OwnerListingBanner hides them); MakeOfferButton uses this instead to
  // show a "this is your listing" notice rather than the real offer form.
  currentUserId?: string;
  myBid?: MyBid;
  // Opt-in: plays the "Ended" ribbon + fade-collapse and calls onEnded once
  // this card's own live countdown reaches zero. Only meant for grids of
  // currently-active listings (ListingSection) — pages that intentionally
  // keep showing already-ended auctions forever (Buying/Selling history)
  // should leave this off.
  removeOnEnd?: boolean;
  onEnded?: () => void;
  // Drops the bottom seller/rating/tier row entirely — every listing in
  // that row is already known to belong to the viewer (their own Selling
  // page), so "Seller: you, 5.0 (2), Hous Trusted Seller" is just noise
  // repeated on every card. Everywhere else the row stays, since a seller's
  // identity is real information there.
  hideSellerFooter?: boolean;
  // Drops Buy It Now/Make an Offer/Place Bid entirely — same "this is
  // your own Selling page" reasoning as hideSellerFooter, one step
  // further: not just noise, these buttons can never do anything but
  // fail (MakeOfferButton's "this is your listing" notice, or a Buy It
  // Now/bid the backend would reject outright) since every listing here
  // is guaranteed the viewer's own. Price/bid-count/shipping info stays —
  // only the action row disappears.
  hideActions?: boolean;
  // Swaps the top-right watch heart for a "⋮" menu (Edit Listing/Delete
  // Listing) — favoriting your own listing isn't a real action, so the
  // Selling page's Active grid trades that corner for one that actually
  // does something here. Off (heart shown) everywhere else.
  ownerMenu?: boolean;
  // Drops just the "⋮" button itself (nothing renders in that corner at
  // all, not even a heart) while keeping every other ownerMenu-driven
  // choice on this card (hideSellerFooter's row, the watcher-count badge)
  // — for a sold/ended listing in the Selling page's History grid, which
  // is still "yours" for display purposes but can never actually be
  // edited or deleted again (internal/listing.Update and Cancel both
  // reject a non-active listing with ErrNotActive regardless of what any
  // UI here offered, so a live menu on a sold card could only ever end in
  // an error). Meaningless when ownerMenu is false.
  ownerMenuReadOnly?: boolean;
}) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [busy, setBusy] = useState(false);
  const msLeft = useMsLeft(listing.endsAt);
  const isOwnListing = Boolean(currentUserId) && listing.sellerId === currentUserId;

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // Only ever read once the auction-with-bids branch of the delete modal
  // is showing — see hasBids/tooCloseToEnd below.
  const [endAction, setEndAction] = useState<EndListingAction>("sell_to_high_bidder");
  const [cancelReason, setCancelReason] = useState<EndListingReason | "">("");
  // Deleting an auction with a real bid on it is no longer a plain,
  // no-consequence removal (internal/auction.EndListing, docs/EditListing.md)
  // — these two flags decide which of the three confirm-dialog bodies below
  // renders. tooCloseToEnd only matters when hasBids is also true, same
  // "auction with bids" gate the backend uses.
  const hasBids = listing.format === "auction" && Boolean(listing.bidCount && listing.bidCount > 0);
  const tooCloseToEnd = hasBids && msLeft !== null && msLeft <= END_EARLY_CUTOFF_MS;

  // Closes the dropdown on any click outside it (button included, so a
  // second click on the button itself just re-triggers its own onClick
  // rather than double-toggling) — the standard "click-away" pattern,
  // since this menu has no other natural dismiss trigger.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuPanelRef.current?.contains(target)) return;
      if (menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen]);

  // The panel is position:fixed (see menuPos below) so it can escape the
  // card's own overflow-hidden — but that means its screen position is only
  // ever correct at the instant it opened. Without this, scrolling the page
  // while the menu is open leaves it floating in place while the "⋮" button
  // (and the whole card) scrolls out from under it — found live, reported
  // as "doesn't stick to where it was on the listing." Closing on scroll,
  // the same dismiss trigger as a click-away, is simpler and more robust
  // than continuously re-measuring the button's position on every scroll
  // tick. `capture: true` is required: scroll events don't bubble, so a
  // listener on `document` in the bubble phase would never see scrolling
  // inside a nested scroll container (e.g. the Selling page's own list) —
  // capture-phase listeners on a common ancestor do still fire for those.
  useEffect(() => {
    if (!menuOpen) return;
    function onScroll() {
      setMenuOpen(false);
    }
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [menuOpen]);

  const photos = listing.imageUrls ?? [];
  const hasCarousel = photos.length > 1;
  const [photoIndex, setPhotoIndex] = useState(0);
  const [hovered, setHovered] = useState(false);

  // Same hover-gated arrow-key nav as ListingRow's search-results carousel
  // — only listens while the mouse is actually over this card (the same
  // condition that reveals the arrow buttons via group-hover below), so
  // arrow keys on a page full of cards always drive whichever one you're
  // pointing at, not a hidden "last card" a screen never showed feedback
  // for.
  useEffect(() => {
    if (!hovered || !hasCarousel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setPhotoIndex((i) => (i + 1) % photos.length);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPhotoIndex((i) => (i - 1 + photos.length) % photos.length);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hovered, hasCarousel, photos.length]);

  // Same shortest-signed-distance-with-wraparound offset math as
  // ListingRow's carousel — only the visual treatment of a nonzero offset
  // differs (see CAROUSEL_SHIFT_PCT above).
  const offsets = useMemo(() => {
    const n = photos.length;
    if (n === 0) return [];
    return photos.map((_, i) => {
      let diff = (((i - photoIndex) % n) + n) % n;
      if (diff > n / 2) diff -= n;
      return diff;
    });
  }, [photos, photoIndex]);

  // Same "jump more than one slot at once fades instead of sliding the
  // long way across" fix as ListingRow, using the same ref-free "adjust
  // state during render" pattern.
  const [prevOffsets, setPrevOffsets] = useState(offsets);
  const isJump = offsets.map((o, i) => Math.abs(o - (prevOffsets[i] ?? o)) > 1.5);
  if (offsets !== prevOffsets) {
    setPrevOffsets(offsets);
  }

  // outcome getting set (cmd/worker's close pass, or a Buy It Now
  // purchase — internal/auction/buynow.go) is what actually means "this
  // auction is over," not just its originally-scheduled end time: a Buy
  // It Now purchase closes an auction before its clock runs out, and
  // msLeft alone can't see that. Without this, a card for an auction
  // someone else already bought outright kept showing a live countdown
  // and a working Buy It Now button — same bug already fixed for Bids/
  // Offers (lib/types.ts's hasBidEnded), just here too, since ListingCard
  // is what every grid on the site (homepage, Selling, watchlist, seller
  // profile) actually renders.
  const hasEnded =
    listing.format === "auction" && (Boolean(listing.outcome) || (msLeft !== null && msLeft <= 0));
  const isUrgent =
    listing.format === "auction" && !hasEnded && msLeft !== null && msLeft > 0 && msLeft <= 60 * 60 * 1000;
  // Undefined for an auction that ended with no bids — that's ended, not
  // sold, and must never render a sale date (see listingSoldAt's own doc).
  const soldAt = listingSoldAt(listing);

  // Only animate the transition into "ended" — a card that's already
  // ended the moment it first mounts (shouldn't happen where removeOnEnd
  // is set, since those grids only ever hold active listings, but is the
  // normal case everywhere else) just renders as ended, no ribbon. Plain
  // useState rather than a ref: its initial-render value is exactly the
  // "was it already ended at mount" snapshot we want, and reading state
  // during render (unlike a ref) is always safe.
  const [alreadyEndedAtMount] = useState(hasEnded);
  const [phase, setPhase] = useState<EndPhase>("live");

  // Adjusted during render rather than in an effect (React's documented
  // pattern for "state driven by another value changing") — msLeft
  // ticks down via useMsLeft's own interval, and the moment it crosses
  // zero this flips phase exactly once (the phase === "live" guard makes
  // it self-stabilizing, so it never loops).
  if (removeOnEnd && phase === "live" && !alreadyEndedAtMount && msLeft !== null && msLeft <= 0) {
    setPhase("ribbon");
  }

  useEffect(() => {
    if (phase === "ribbon") {
      const t = setTimeout(() => setPhase("collapsing"), RIBBON_MS);
      return () => clearTimeout(t);
    }
    if (phase === "collapsing") {
      const t = setTimeout(() => onEnded?.(), COLLAPSE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, onEnded]);

  // Independent of removeOnEnd/the ribbon — every card, everywhere it
  // renders (homepage, Buying, Selling, seller profile), pokes the
  // celebration watcher the instant its own countdown reaches zero, so
  // whoever's actually looking at their auction end sees "Bid Won!"/"Item
  // Sold!" immediately rather than waiting for the next scheduled poll.
  const poke = usePokeCelebrations();
  const hasPoked = useRef(false);
  useEffect(() => {
    if (alreadyEndedAtMount || hasPoked.current) return;
    if (msLeft !== null && msLeft <= 0) {
      hasPoked.current = true;
      poke();
    }
  }, [msLeft, alreadyEndedAtMount, poke]);

  return (
    <>
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative flex flex-col overflow-hidden rounded-xl border border-brand-border bg-white transition-shadow hover:shadow-md ${
        phase === "collapsing" ? "animate-card-fade-collapse" : ""
      }`}
    >
      {(phase === "ribbon" || phase === "collapsing") && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
          <div className="w-[150%] animate-ended-ribbon bg-brand-urgent py-1.5 text-center text-sm font-extrabold uppercase tracking-wider text-white shadow-lg">
            Ended
          </div>
        </div>
      )}

      <Link
        href={`/listing/${listing.id}`}
        className="relative block aspect-[4/5] overflow-hidden"
      >
        {hasCarousel ? (
          <div className="relative h-full w-full transition-transform duration-300 group-hover:scale-105">
            {photos.map((url, i) => {
              const offset = offsets[i];
              return (
                <div
                  key={url}
                  className="absolute inset-0"
                  style={{
                    transform: `translateX(${offset * CAROUSEL_SHIFT_PCT}%)`,
                    opacity: offset === 0 ? 1 : 0,
                    zIndex: offset === 0 ? 10 : 0,
                    transitionProperty: isJump[i] ? "opacity" : "transform, opacity",
                    transitionDuration: "380ms",
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    pointerEvents: "none",
                  }}
                >
                  <ListingImage src={url} game={listing.game} label={listing.title} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full w-full transition-transform duration-300 group-hover:scale-105">
            <ListingImage src={photos[0]} game={listing.game} label={listing.title} />
          </div>
        )}

        {hasCarousel && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setPhotoIndex((i) => (i - 1 + photos.length) % photos.length);
              }}
              aria-label="Previous photo"
              className="absolute left-1.5 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setPhotoIndex((i) => (i + 1) % photos.length);
              }}
              aria-label="Next photo"
              className="absolute right-1.5 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100"
            >
              <ChevronRight size={16} />
            </button>

            <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 gap-1 opacity-40 transition-opacity group-hover:opacity-100">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full border-[0.5px] border-black ${
                    i === photoIndex ? "bg-brand-gold" : "bg-white"
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {listing.format === "auction" ? (
          <span className="absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-full bg-brand-success px-2 py-1 text-[11px] font-semibold text-white">
            <Gavel size={12} /> Auction{listing.buyItNowPriceCents ? " / Buy It Now" : ""}
          </span>
        ) : (
          <span className="absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-full bg-brand-success px-2 py-1 text-[11px] font-semibold text-white">
            <Zap size={12} /> Buy It Now
          </span>
        )}

        {ownerMenu ? (
          ownerMenuReadOnly ? null : (
            <button
              ref={menuButtonRef}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (menuOpen) {
                  setMenuOpen(false);
                  return;
                }
                const rect = menuButtonRef.current?.getBoundingClientRect();
                if (rect) {
                  setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                }
                setMenuOpen(true);
              }}
              aria-label="Listing options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors hover:bg-white"
            >
              <MoreVertical size={16} className="text-gray-600" />
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={async (e) => {
              e.preventDefault();
              if (busy) return;
              if (!isLoggedIn) {
                router.push("/login");
                return;
              }
              setBusy(true);
              try {
                const status = await apiFetch(`/listings/${listing.id}/watch`, {
                  method: watching ? "DELETE" : "POST",
                });
                setWatching(status.watching);
              } catch {
                // Leave state as-is on failure.
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            aria-label={watching ? "Remove from watchlist" : "Add to watchlist"}
            className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors hover:bg-white disabled:opacity-60"
          >
            <Heart
              size={16}
              className={watching ? "fill-brand-urgent text-brand-urgent" : "text-gray-500"}
            />
          </button>
        )}

        {ownerMenu && (
          // Real watcher count (listing.watcherCount — the same live
          // count() the detail page's own WatchBadge reads, never
          // fabricated), only shown on the Selling page's own cards: this
          // is the seller checking how much interest their listing is
          // getting, not something a buyer browsing needs to see here.
          <span className="absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-sm backdrop-blur">
            <Heart size={12} className="text-gray-500" />
            {listing.watcherCount} {listing.watcherCount === 1 ? "Watcher" : "Watchers"}
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-gold">
            {listing.game}
          </p>
          <Link href={`/listing/${listing.id}`}>
            <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 hover:underline">
              {listing.title}
            </h3>
          </Link>
          <p className="mt-0.5 text-xs text-gray-500">
            {listing.set}
            {listing.isGraded
              ? ` · ${listing.gradingCompany} ${listing.grade}`
              : ` · ${listing.condition}`}
          </p>
        </div>

        <div>
          {listing.format === "auction" ? (
            <div>
              <p className="text-[11px] text-gray-500">{hasEnded ? "Final price" : "Current bid"}</p>
              <p className={`text-lg font-bold ${hasEnded ? "text-brand-urgent" : "text-gray-900"}`}>
                {formatPrice(listing.currentPriceCents ?? 0)}
              </p>
              <p className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{listing.bidCount ?? 0} bids</span>
                <span
                  className={isUrgent ? "font-semibold text-brand-urgent" : "text-gray-500"}
                  // The server renders this at request time; hydration
                  // happens a moment (often ~1s) later, so the two
                  // Date.now()-derived countdown strings almost never
                  // match exactly. suppressHydrationWarning is React's
                  // documented escape hatch for exactly this "ticking
                  // clock" case — useMsLeft's own interval corrects the
                  // one-second discrepancy within its next tick anyway.
                  suppressHydrationWarning
                >
                  {hasEnded ? "Ended" : msLeft !== null ? formatMsLeft(msLeft) : ""}
                </span>
              </p>
              {soldAt && (
                <p className="mt-0.5 text-sm font-semibold text-gray-900">
                  Sold {formatDateTime(soldAt)}
                </p>
              )}
              {myBid && myBid.status === "winning" && !hasEnded && (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-brand-success">
                  <Check size={12} /> Top bidder · up to {formatPrice(myBid.myMaxBidCents)}
                </p>
              )}
              <ShippingLine listing={listing} className="mt-1" />
              {listing.buyItNowPriceCents && !hasEnded && isLoggedIn && !hideActions && (
                <div className="mt-2 flex items-stretch gap-1.5">
                  <BuyNowButton
                    listingId={listing.id}
                    priceCents={listing.buyItNowPriceCents}
                    // "split" once the offer square sits next to it — this
                    // is the only place on the card the Buy It Now price
                    // shows at all (unlike the fixed-price branch below,
                    // whose big price above the button already IS the Buy
                    // It Now price), so it needs to stay visible even in
                    // the narrower leftover space.
                    variant={listing.allowOffers ? "split" : "default"}
                    className="flex-1"
                  />
                  {listing.allowOffers && (
                    <MakeOfferButton
                      listingId={listing.id}
                      binPriceCents={listing.buyItNowPriceCents}
                      minOfferCents={listing.minOfferCents}
                      isOwnListing={isOwnListing}
                      variant="icon"
                    />
                  )}
                </div>
              )}
              {!listing.buyItNowPriceCents && !hasEnded && isLoggedIn && !hideActions && (
                // No Buy It Now on a plain auction means the block above
                // (title/set -> price -> bids/time -> shipping) is shorter
                // than its Buy-It-Now sibling — this fills that same slot
                // rather than leaving it as dead space above the flex-1
                // spacer. Doesn't place a bid itself, just gets the bidder
                // to BidBox on the real listing page — same "no inline
                // purchase, always go through the real flow" shape as
                // BuyNowButton not buying anything directly either.
                <button
                  type="button"
                  onClick={() => router.push(`/listing/${listing.id}`)}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-navy px-4 py-2.5 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5"
                >
                  <Gavel size={16} /> Place Bid
                </button>
              )}
            </div>
          ) : (
            <div>
              <p
                className={`text-lg font-bold ${listing.buyerId ? "text-brand-urgent" : "text-gray-900"}`}
              >
                {formatPrice(listing.soldPriceCents ?? listing.priceCents ?? 0)}
              </p>
              <ShippingLine listing={listing} />
              {listing.buyerId ? (
                <p className="mt-2 text-sm font-semibold text-gray-900">
                  Sold{soldAt ? ` ${formatDateTime(soldAt)}` : ""}
                </p>
              ) : isLoggedIn && !hideActions ? (
                <div className="mt-2 flex items-stretch gap-1.5">
                  <BuyNowButton
                    listingId={listing.id}
                    priceCents={listing.priceCents ?? 0}
                    // Same "split" treatment as the auction branch above,
                    // once the offer square is sitting next to it — keeps
                    // both cards visually consistent rather than this one
                    // dropping to a bare "Buy It Now" label.
                    variant={listing.allowOffers ? "split" : "default"}
                    className="flex-1"
                  />
                  {listing.allowOffers && (
                    <MakeOfferButton
                      listingId={listing.id}
                      binPriceCents={listing.priceCents ?? 0}
                      minOfferCents={listing.minOfferCents}
                      isOwnListing={isOwnListing}
                      variant="icon"
                    />
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Absorbs whatever vertical space is left over once the price
            block above (which varies in height — an auction with no Buy
            It Now button is shorter than one with the button+offer icon
            row) has laid out naturally. Keeps the price pinned directly
            under the title/set on every card instead of being pushed down
            by mt-auto to align with the tallest sibling in the grid row —
            the empty space collects here, below shipping, instead of
            above the price. */}
        <div className="flex-1" />

        {!hideSellerFooter && (
        <div className="flex items-start justify-between gap-1.5 border-t border-brand-border pt-2 text-[11px] text-gray-500">
          <div className="min-w-0 flex-1">
            {listing.sellerUsername ? (
              <Link
                href={`/seller/${listing.sellerUsername}`}
                className="block truncate hover:text-brand-navy"
                onClick={(e) => e.stopPropagation()}
              >
                {listing.sellerUsername}
              </Link>
            ) : (
              <span className="block truncate">Seller</span>
            )}
            {listing.sellerUsername ? (
              <Link
                href={`/seller/${listing.sellerUsername}#reviews`}
                className="mt-0.5 flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px] hover:text-brand-navy"
                onClick={(e) => e.stopPropagation()}
              >
                <StarRating
                  rating={listing.sellerRatingAvg}
                  size={10}
                  filledClassName="fill-brand-gold text-brand-gold"
                  emptyClassName="text-brand-border"
                />
                {listing.sellerReviewCount > 0
                  ? `${listing.sellerRatingAvg.toFixed(1)} (${formatCompactCount(listing.sellerReviewCount)})`
                  : "No reviews yet"}
              </Link>
            ) : (
              <span className="mt-0.5 flex min-w-0 items-center gap-1 whitespace-nowrap text-[11px]">
                <StarRating
                  rating={listing.sellerRatingAvg}
                  size={10}
                  filledClassName="fill-brand-gold text-brand-gold"
                  emptyClassName="text-brand-border"
                />
                {listing.sellerReviewCount > 0
                  ? `${listing.sellerRatingAvg.toFixed(1)} (${formatCompactCount(listing.sellerReviewCount)})`
                  : "No reviews yet"}
              </span>
            )}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-surface px-1.5 py-1 text-[10px] font-medium text-gray-600">
            {sellerTierIconSrc(listing.sellerTier) ? (
              <Image
                src={sellerTierIconSrc(listing.sellerTier)!}
                alt=""
                width={16}
                height={16}
                unoptimized
                className="shrink-0"
              />
            ) : (
              <ShieldCheck size={14} className="shrink-0" />
            )}
            {/* Every formatSellerTier string ends in " Seller" (New/Bronze/
                Silver/Gold/Platinum/Hous Trusted) — split it onto its own
                second line rather than letting the pill stretch wide or the
                text wrap mid-word, e.g. "Hous Trusted" / "Seller". */}
            <span className="flex flex-col items-center text-center leading-tight">
              <span>{formatSellerTier(listing.sellerTier).replace(/ Seller$/, "")}</span>
              <span>Seller</span>
            </span>
          </span>
        </div>
        )}
      </div>
    </div>

    {ownerMenu && menuOpen && (
      // position: fixed (computed from the button's own rect, not CSS
      // absolute) specifically because both the card and the image Link
      // above have overflow-hidden — an absolutely-positioned dropdown
      // would get clipped the instant it extended past either box.
      <div
        ref={menuPanelRef}
        role="menu"
        style={{ top: menuPos.top, right: menuPos.right }}
        className="fixed z-50 w-44 overflow-hidden rounded-lg border border-brand-border bg-white py-1 shadow-lg"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            router.push(`/sell/edit/${listing.id}`);
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-brand-surface"
        >
          <Pencil size={14} /> Edit Listing
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            setDeleteError("");
            setEndAction("sell_to_high_bidder");
            setCancelReason("");
            setConfirmDeleteOpen(true);
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-urgent hover:bg-brand-urgent/5"
        >
          <Trash2 size={14} /> Delete Listing
        </button>
      </div>
    )}

    {ownerMenu && confirmDeleteOpen && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget && !deleting) setConfirmDeleteOpen(false);
        }}
      >
        <div role="dialog" aria-modal="true" aria-label="Delete listing" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-gray-900">Delete Listing</h2>
            <button
              type="button"
              onClick={() => !deleting && setConfirmDeleteOpen(false)}
              aria-label="Close"
              className="rounded-md p-1 text-gray-400 transition-colors hover:bg-brand-surface hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>
          {tooCloseToEnd ? (
            // Real eBay: an auction with a bid can't be ended early at all
            // once it's this close to its scheduled end — the only path
            // left is letting it close naturally. No Delete action here at
            // all, matching the backend's own hard ErrTooCloseToEnd.
            <>
              <p className="mt-3 text-sm text-gray-600">
                &ldquo;{listing.title}&rdquo; has a bid and ends in less than 12 hours — same as real
                eBay, it can no longer be ended early. It has to run its course.
              </p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-brand-surface"
                >
                  Close
                </button>
              </div>
            </>
          ) : hasBids ? (
            // eBay-parity choice (docs/EditListing.md) — once there's a real
            // bidder, "delete" isn't a free no-consequence action anymore:
            // the seller either honors the current high bid as a real sale,
            // or explicitly voids every bid with a stated reason.
            <>
              <p className="mt-3 text-sm text-gray-600">
                &ldquo;{listing.title}&rdquo; has a bid. Real eBay doesn&apos;t let you just delete a
                listing once someone&apos;s bid on it — choose one:
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-2.5 text-sm has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/5">
                  <input
                    type="radio"
                    name={`end-action-${listing.id}`}
                    checked={endAction === "sell_to_high_bidder"}
                    onChange={() => setEndAction("sell_to_high_bidder")}
                    className="mt-0.5 accent-brand-navy"
                  />
                  <span>
                    <span className="block font-medium text-gray-900">Sell to the current high bidder</span>
                    <span className="block text-xs text-gray-500">
                      Ends the auction right now as a real sale, for {formatPrice(listing.currentPriceCents ?? 0)}.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-2.5 text-sm has-[:checked]:border-brand-navy has-[:checked]:bg-brand-navy/5">
                  <input
                    type="radio"
                    name={`end-action-${listing.id}`}
                    checked={endAction === "cancel_bids"}
                    onChange={() => setEndAction("cancel_bids")}
                    className="mt-0.5 accent-brand-navy"
                  />
                  <span>
                    <span className="block font-medium text-gray-900">Cancel all bids</span>
                    <span className="block text-xs text-gray-500">
                      Voids every bid on this listing — no sale happens.
                    </span>
                  </span>
                </label>
              </div>
              {endAction === "cancel_bids" && (
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value as EndListingReason)}
                  className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
                >
                  <option value="">Select a reason…</option>
                  {Object.entries(END_LISTING_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              {deleteError && <p className="mt-2 text-xs text-brand-urgent">{deleteError}</p>}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={deleting || (endAction === "cancel_bids" && !cancelReason)}
                  onClick={async () => {
                    setDeleting(true);
                    setDeleteError("");
                    try {
                      await cancelListing(listing.id, {
                        action: endAction,
                        reason: endAction === "cancel_bids" ? (cancelReason as EndListingReason) : undefined,
                      });
                      setConfirmDeleteOpen(false);
                      router.refresh();
                    } catch (err) {
                      setDeleteError(err instanceof ApiError ? err.message : "Failed to end this listing.");
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="flex-1 rounded-lg bg-brand-urgent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-urgent/90 disabled:opacity-50"
                >
                  {deleting
                    ? "Working..."
                    : endAction === "sell_to_high_bidder"
                      ? "End Auction & Sell"
                      : "Cancel Bids & End Listing"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-brand-surface"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-gray-600">
                Remove &ldquo;{listing.title}&rdquo; from AuctionHous? This can&apos;t be undone.
              </p>
              {deleteError && <p className="mt-2 text-xs text-brand-urgent">{deleteError}</p>}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setDeleteError("");
                    try {
                      await cancelListing(listing.id);
                      setConfirmDeleteOpen(false);
                      router.refresh();
                    } catch (err) {
                      setDeleteError(err instanceof ApiError ? err.message : "Failed to delete listing.");
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="flex-1 rounded-lg bg-brand-urgent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-urgent/90 disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-brand-surface"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}

// "+$1.56 · [envelope icon] Tracked Envelope" — the cost from
// shippingBadge, a container icon keyed off shippingPreset, then the
// method name, so a buyer sees what it physically ships in without
// clicking into the listing.
function ShippingLine({ listing, className = "" }: { listing: Listing; className?: string }) {
  const { costLabel, methodLabel } = shippingBadge(listing);
  const Icon = SHIPPING_PRESET_ICONS[listing.shippingPreset];
  return (
    <p className={`flex items-center gap-1 text-xs text-gray-500 ${className}`}>
      {costLabel && <span>{costLabel}</span>}
      {costLabel && <span aria-hidden="true">·</span>}
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{methodLabel}</span>
    </p>
  );
}
