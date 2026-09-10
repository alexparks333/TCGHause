# Edit Listing & Delete Listing — Rules Reference

**Status: this describes a real, live, built feature** (`EditListingForm.tsx`,
`internal/listing.Update`, `internal/auction.EndListing`), not a proposal. Written as a
source-of-truth for a future buyer/seller-facing FAQ page — every rule below is what
the product actually enforces today, not aspirational. Where a rule is a direct port of
a real eBay policy, the eBay source is cited; where AuctionHous-TCG deliberately
diverges from eBay, that's called out explicitly rather than left implicit.

**Scope note (§7 of this doc):** the "no listing fee to lose" difference in §7.4 is a
real, current fact about this app's fee model (percentage-of-sale only, no upfront
listing fee — see `docs/PercentageModel.md`), not a promise about the future. If a
listing-fee model is ever added, that section's reasoning would need to be revisited.

---

## 1. The three-tab Edit Listing form

Reachable from the Selling page's "⋮" menu → "Edit Listing" on any of your own active
listings. Laid out as three tabs — **Details**, **Price**, **Photos** — mirroring the
Sell wizard's own three-part shape. All three tabs share one form; switching tabs never
loses an in-progress edit, and Save commits every tab's changes in one request.

**What's editable depends entirely on the listing's format and bid state** — nothing in
this form is a blanket "always editable" or "never editable" field:

| Listing state | Details (title/set/card #/rarity) | Price / Buy It Now / Offers | Shipping | Photos |
|---|---|---|---|---|
| Fixed-price ("Buy It Now only") | ✅ Editable, any time before it sells | ✅ Up or down, freely | ✅ Freely | ✅ Add/delete/reorder freely |
| Auction, zero bids | ✅ Editable | Starting bid & Buy It Now: **lower only**, never raised (§2) | ✅ Freely | ✅ Add/delete/reorder freely |
| Auction, 1+ bids | 🔒 Locked | 🔒 Locked; Buy It Now is gone entirely (§3) | 🔒 Locked | 🔒 Locked |

Game and Condition are **never** editable through this form, in any state — game
defines the whole item-specifics schema (CLAUDE.md §6.2), and condition is a claim a
buyer weighs when bidding/buying, safer left to a fresh listing than silently revised
underneath them.

The instant an auction gets its first bid, the whole form flips to the locked state —
there is no partial-lock. This is stricter than eBay allows in one respect (eBay does
let a seller revise *some* things even after a bid in narrow cases) and looser in
another (eBay's revise is decrease-only pre-bid on price fields; AuctionHous applies
that same decrease-only rule identically). The one deliberate exception to "revise
existing value only" is **photos and the Details fields**, which can change freely
right up until the bid-lock point — there's no "decrease-only" concept for a title or
a photo the way there is for a price.

## 2. Why price fields are lower-only before the first bid

Real eBay's revise-a-listing flow is **decrease-only** on price fields — a seller can
lower a Buy It Now/starting-bid price after publishing, but never raise it, even before
any bid exists. The reasoning eBay gives (and this app copies exactly): a buyer who's
already seen the listing at one price shouldn't have that price quietly raised on them
between viewings.
([eBay: Revising your listing](https://www.ebay.com/help/selling/listings/creating-managing-listings/revising-your-listing?id=4083))

Shipping and photos are **not** subject to this decrease-only rule — there's no
"direction" to a shipping method or a photo, so the rule doesn't translate; both are
freely editable pre-bid, same as post-creation on a fixed-price listing.

## 3. Buy It Now disappears the instant an auction gets its first bid

Real eBay: for a **non-reserve** auction, Buy It Now is only available before the first
bid lands — the moment a bid is placed, Buy It Now vanishes from the listing entirely,
for every subsequent visitor, not just the person who bid.
([eBay: About auctions](https://www.ebay.com/help/buying/bidding/auctions?id=4014))

AuctionHous-TCG mirrors this exactly: `internal/auction.PlaceBid` clears
`buy_it_now_price_cents` to null the moment a bid is placed, in the same transaction as
the bid itself — not a display-layer hide, a real data change. Every frontend surface
(listing card badge, detail page, the Edit form) already reads that field, so Buy It
Now disappearing everywhere is a consequence of that one write, not something each
screen has to separately implement.

## 4. Photo-edit audit log

Every real change to a listing's photos (add, delete, or a pure reorder — even
reordering with the same set of photos counts) is recorded to
`listing_photo_edits`: the full **before** and **after** photo-URL arrays, who made the
change, and when. Not eBay-derived (eBay doesn't publish anything like this) — a
direct answer to "what if a seller swaps the photos right before it sells and a buyer
claims that's fraud." A no-op save (nothing actually changed) logs nothing.

This log is **admin-only**, surfaced on the claim-review screen
(`/admin/claims/{id}`) for the specific listing a claim is about — a reviewer can see
the real photo history next to the claim they're deciding, rather than taking either
side's word for it. It is not shown to the buyer or seller themselves.

---

## 5. Delete Listing — eBay's real early-ending rules

This is the section this document exists to capture. **Deleting a listing that has
never had a bid is still free and instant** — no rules below apply to that case, it's
a plain, no-consequence removal (`internal/listing.Cancel`). Everything below only
applies once **an auction has at least one real bid**.

### 5.1 What real eBay actually allows

Researched directly against eBay's own seller help docs and Trading API developer
docs, not guessed:

- **A seller can never just "delete" an auction with bids and walk away clean.** There
  is no such option on real eBay. Ending an auction with bids requires the seller to
  pick one of two real outcomes.
- **More than 12 hours before the scheduled end, with a qualifying bid:** the seller
  can end the listing early, but must choose:
  - **Sell to the current high bidder** — ends the auction immediately as a real,
    successful sale to whoever's currently winning.
  - **Cancel all bids** — every bid is voided, the listing ends with no sale. eBay
    requires the seller to select a reason (e.g. the item is lost, broken, or no
    longer available).
- **12 hours or less before the scheduled end, with a qualifying bid:** eBay blocks
  ending the listing early entirely — the *only* remaining outcome is selling to the
  high bidder when the clock naturally runs out. There is no cancel option this close
  to close, full stop.
  ([eBay: Ending a listing](https://www.ebay.com/help/selling/listings/creating-managing-listings/ending-listing?id=4146),
  [eBay Trading API: Ending an item listing early](https://www.developer.ebay.com/api-docs/user-guides/static/trading-user-guide/end-early.html))
- **Ending early is never a free action, even when it's allowed.** eBay does not
  refund any listing-related fees for an early end, and if the item sells to the high
  bidder, the normal final value fee still applies to that sale just like a natural
  close.
- **eBay actively discourages doing this repeatedly.** Ending listings early
  disappoints bidders who were relying on the auction running its course; a seller
  who does this often can have limits or restrictions placed on their account.

### 5.2 What AuctionHous-TCG implements (1:1 port)

`internal/auction.EndListing` is the real entry point behind "Delete Listing" now,
replacing the old, stricter "always blocked once there's a bid" behavior:

| eBay rule | AuctionHous-TCG implementation |
|---|---|
| No bids → free, instant end | `EndListing` delegates straight to the old `listing.Cancel` — unchanged, unconditional |
| Bids exist, > 12h left → seller must choose | Delete Listing modal presents the same two choices as a radio pair; the confirm button is disabled until one is picked (and, for "cancel," until a reason is picked too) |
| "Sell to the current high bidder" | Force-closes the auction *right now*, reusing the exact same finalization code path a natural timer-close uses (`closeOne`, shared with `cmd/worker`'s sweep) — real outcome `"sold"`, a real pending order is created immediately, notifications fire, identical to what would have happened if the clock had simply run out |
| "Cancel all bids," reason required | Voids the auction: outcome becomes `"cancelled"`, the listing's status becomes `"cancelled"` (the same status a never-bid-on delete already used), and `high_bidder_id` is cleared so nobody is later shown a false "you won" message. **The bid rows themselves are never deleted or mutated** — they remain a permanent, honest record of what actually happened, the same "never mutate history" principle this codebase already applies to the (removed) wallet ledger design |
| 12h-or-less cutoff → blocked entirely | `EndListing` returns a hard error (`ErrTooCloseToEnd`) before even looking at what action was requested; the UI detects this client-side too and shows a blocked state with no delete option at all, only a "Close" button |
| Final value fee still applies on an early sale | Reused directly — the same fee-quoting code (`internal/order`) that runs on a natural close runs here too, no special-cased "early end" fee logic to keep in sync |
| No fee refund for ending early | **Doesn't apply to this app** — AuctionHous-TCG has no upfront listing fee to refund in the first place (percentage-of-sale-only model, `docs/PercentageModel.md`); there's nothing analogous to void |
| Account restrictions for repeat early-enders | **Not implemented.** No account-standing/limits system exists yet to hang this off of (see CLAUDE.md §6.4's seller-tier machinery, which doesn't track this specific behavior) — a real gap versus eBay, flagged here rather than silently skipped |

### 5.3 The three cancellation reasons

Trimmed from eBay's full `EndReasonCodeType` enum down to what actually applies on a
single-item collectibles marketplace (eBay's API supports more granular reasons aimed
at multi-quantity/business listings that don't exist here):

| Value | Shown to the seller as |
|---|---|
| `lost_or_broken` | "The item is lost or broken" |
| `error_in_listing` | "There was an error in the listing" |
| `not_available` | "The item is no longer available to sell" |

### 5.4 What a bidder sees after each outcome

- **Sold (ended early, honored the high bid):** identical to a normal win — the bidder
  gets a real order, a "you won" notification, and a payment step, exactly as if the
  auction had closed naturally.
- **Cancelled (bids voided):** the listing disappears from the bidder's own
  Buying/Bids-Offers pages entirely (same status-based filter that already excludes
  any non-active/non-ended listing everywhere else in the app) — no "you lost" or "you
  were outbid" message, since there was never a real close to report on. Someone who
  still has the listing's detail page open sees "The seller ended this auction and
  voided every bid."

---

## 6. Quick reference: is X editable right now?

A fast lookup for FAQ copy — "can I still change my listing?":

- **"I listed it wrong (wrong title/set/card number/rarity), no one's bid yet."** →
  Yes, edit it directly on the Details tab, any time before a bid comes in (or always,
  if it's a fixed-price listing).
- **"I want to lower my price."** → Yes, always, on either format, any time before a
  bid exists (for an auction) or before it sells (fixed-price).
- **"I want to raise my price."** → Only if it's fixed-price. An auction's starting
  bid/Buy It Now can only ever go down or be removed, matching eBay's own decrease-only
  revise rule (§2).
- **"I want to change my photos."** → Yes, under the exact same rule as price: freely
  on fixed-price, freely on an auction with no bids yet, locked the instant a bid
  lands.
- **"Someone already bid — can I just take the listing down?"** → Not for free anymore.
  See §5: more than 12 hours before it ends, you can either sell to the current high
  bidder or void every bid with a stated reason; 12 hours or less before it ends,
  neither option is available and it has to run its course.

---

## 7. Sources

- [eBay: Ending a listing](https://www.ebay.com/help/selling/listings/creating-managing-listings/ending-listing?id=4146)
- [eBay Trading API: Ending an item listing early](https://www.developer.ebay.com/api-docs/user-guides/static/trading-user-guide/end-early.html)
- [eBay: Revising your listing](https://www.ebay.com/help/selling/listings/creating-managing-listings/revising-your-listing?id=4083)
- [eBay: About auctions](https://www.ebay.com/help/buying/bidding/auctions?id=4014)
- `docs/PercentageModel.md` — this app's real fee model (why §5.2's "no fee refund"
  row doesn't apply)
- `CLAUDE.md` §6.13 — the original eBay-parity research and implementation notes for
  Buy It Now disappearing on first bid and decrease-only price revision
