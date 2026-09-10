# Sale Flow Plan — payment deadline, flat claim window, buyer-completed release, 70/30 split

**Status:** implementation plan, not yet built (except where a section says
otherwise). Written from a walkthrough the user gave of exactly how a sale
should feel end to end. Several related things have shipped since, in
separate passes, and aren't part of this plan: the real `charge.dispute.*`
webhook (`internal/chargeback`); the tier-based instant-release shortcut,
which applies to **Hous Trust only** (Gold and Platinum do not get it); a
real, running tier-promotion engine (`internal/seller/promotion.go`,
`cmd/worker`'s daily recompute); and Hous Trust becoming its own top tier
above Platinum, reached only through a real application process with a
per-seller negotiated commission rate, never by order volume — see
`docs/PercentageModel.md` §4 and §6.1 for all of this, current and accurate
as of this pass.

This doc is the rest of that walkthrough, turned into buildable steps.

---

## 1. The transaction-page bubbles, as described

> The seller bubble is "Seller (You)" which is filled immediately, then the
> next bubble is "Paid" ... Then awaiting shipment ... Then shipped ... Then
> delivered ... buyer has a 48 hour claim window ... money gets released to
> the seller's wallet.

Reconciled against what's actually on the page today
(`apps/web/lib/orderSteps.ts`'s `ORDER_STEPS`, rendered by
`OrderStatusPanel.tsx`'s `Timeline`):

```
Today:  Paid → Awaiting shipment → Shipped → Delivered → Claim window → Released to seller
Wanted: Sold(You) → Paid → Awaiting shipment → Shipped → Delivered → Claim window → Released
```

The only structural gap is the **leading "Sold"/"Seller (You)" bubble** —
today the timeline starts at `Paid`; there's no visible step for "the sale
happened, we're just waiting on payment now." That's because right now,
`created`/`payment_pending` are near-instantaneous states (a Buy It Now or
paid-won-auction purchase is charged synchronously, in the same request the
buyer submits it) — there's no real gap in time for a bubble to represent yet.
**§2 below is what turns that into a real, visible waiting period**, which is
exactly what makes a leading bubble worth having.

### 1.1 Build step

- Add a leading step to `ORDER_STEPS`: `{ state: "created", label: "Sold" }`
  (or `payment_pending`, once §2 exists — see there for which state is the
  right one to key off of). `Timeline`'s existing `currentIndex >= 0 && i <=
  currentIndex` logic already marks every step up to and including the
  current one as done, so a `created` order shows exactly one filled bubble
  ("Sold") and the rest hollow — no other frontend logic changes needed.
- Nothing on the backend changes for this step alone; it's a label/ordering
  change in `orderSteps.ts` only, once §2 gives `created` a real duration to
  represent.

---

## 2. A 24-hour payment deadline after winning an auction

> The Buyer has 24 hours to complete the payment.

**This doesn't exist today.** Confirmed by direct search: no payment-deadline
concept anywhere in `internal/order`, `internal/auction`, or any migration.
Today, winning an auction and paying for it are already two separate steps in
the UI (Bids/Offers' "Awaiting Payment" action calls `PayForWonAuction`
separately from the bid/close flow) — but there's no clock on how long a
winner can wait before paying, and no consequence if they never do.

There's also an existing, already-flagged gap this plan needs to resolve, not
create: `internal/webhook/webhook.go`'s `cancelPaymentPendingOrder` doc
comment already says plainly —

> "Reopening a listing after a days-later payment failure is a real product
> decision (relist automatically? notify the seller to relist manually? does
> the second-highest bidder get first refusal?) that design doc v2 doesn't
> specify — not resolved here."

Building the 24-hour deadline means finally answering that question, not
just adding a timer.

### 2.1 Proposed mechanics

- `orders` gains a `payment_deadline` column (nullable — only auction wins
  need one; a Buy It Now/fixed-price purchase pays synchronously in the same
  request it's created in, so it never sits in `created` at all and never
  needs a deadline).
- `order.CreateFromWin`, when called from a won-auction path (not a Buy It
  Now path), sets `payment_deadline = now() + 24 hours` at insert time.
- A new worker timer (`cmd/worker`, same shape as `order_timers.go`'s
  existing ones): orders sitting in `created` past their `payment_deadline`
  get cancelled.
- **The open product question this plan can't resolve on its own**: what
  happens to the listing/auction when this fires? Three real options, worth
  a decision before building this:
  1. Relist automatically (reopen the auction for the same duration).
  2. Notify the seller and let them manually relist.
  3. Offer the item to the second-highest bidder at their max bid (a
     "second-chance offer," the eBay-precedented mechanic for exactly this
     situation).
  Recommend (3) if there's meaningful bidding activity on typical auctions —
  it recovers a sale without the seller doing anything — falling back to (2)
  for a single-bid or Buy-It-Now-only listing where there's no second bidder
  to fall back to.

### 2.2 Where this shows up on the transaction page

The `created` state, once it has a real 24-hour window behind it, is exactly
what the "Sold (You)" bubble in §1 represents — filled the instant the
auction ends, with the *next* bubble ("Paid") only filling once the buyer
actually completes payment inside that window. A countdown ("23h left to
pay") is a natural addition to `OrderStatusPanel` for a buyer viewing their
own won-and-unpaid auction.

---

## 3. A flat 48-hour claim window, replacing the current $250-based split

> Once we get the notification that the delivery has [completed], the buyer
> has a 48 hour Claim Window. If they do not claim in 48 Hours from delivery,
> then they do not get any chance to claim again.

**This is a real, deliberate change from what's live today.**
`docs/PercentageModel.md` §6.1 (current, accurate as of this pass) documents
the shipped behavior: **3 days** for orders under $250, **7 days** for $250+
(`internal/order/fulfillment.go`'s `highValueThresholdCents` branch). The
walkthrough above describes a single flat **48-hour** window instead, with no
value-based branching at all.

Flagging the tradeoff plainly rather than just implementing the smaller
number silently: a flat 48h window is **shorter** than the current 3-day
floor for every order, and dramatically shorter than the current 7-day
window for $250+ orders (exactly the orders — graded slabs, high-end
singles — where a buyer is statistically more likely to want time to
carefully inspect the item before it's too late to claim). This is a real
buyer-protection tradeoff, not just a number swap — recommend confirming
this is the intended effect (faster payouts to sellers, shorter buyer
inspection window across the board, no value-based carve-out) before it
ships, since it's a strictly less generous buyer window on high-value orders
than what's live today.

### 3.1 Build step (small, contained, once confirmed)

`internal/order/fulfillment.go`'s `MarkDelivered`:

```go
// Before:
window := 3 * 24 * time.Hour
if chargedCents >= highValueThresholdCents {
    window = 7 * 24 * time.Hour
}

// After:
window := 48 * time.Hour
```

`highValueThresholdCents` and the `chargedCents` read become dead code and
should be removed along with the branch, not left orphaned.
**Nothing else needs to change** — the claim-window-elapsed worker
(`cmd/worker/order_timers.go`'s `releaseElapsedClaimWindows`) just reads
`claim_deadline` off the order, it has no independent notion of 3/7 days
baked in, so it needs zero changes for this.

### 3.2 The "no second chance" rule is already true, just needs saying explicitly

"If they do not claim in 48 hours... they do not get any chance to claim
again" is already exactly how the state machine works: once `claim_window`
transitions to `released` (worker timer) or `claim_open` (a claim was
filed), there is no edge back to `claim_window` in `internal/order`'s
transition table (`order.go`'s `transitions` map) — a released order simply
has no claim-filing path left. No code change needed for this part; it's
already structurally enforced by the state machine's shape, not by a
business-logic check that could be bypassed.

---

## 4. Filing a claim already stops the auto-release timer — confirmed, not a gap

> If a claim is filed for an order, then stop the 48 hour timer that auto
> releases the funds to the seller, because we might need to send the money
> back to the buyer.

**This is already true today**, and stays true once §3's flat-48h change
ships — no new code needed, but worth spelling out exactly why, since it's
easy to assume this needs a manual "pause" mechanism when it doesn't:

- `internal/dispute.OpenClaim` transitions the order from `claim_window`
  directly to `claim_open` in the same call that creates the claim
  (`order.Transition(ctx, pool, orderID, order.StateClaimWindow,
  order.StateClaimOpen)`).
- `cmd/worker`'s `releaseElapsedClaimWindows` only ever selects orders whose
  `state = 'claim_window'`. The instant an order moves to `claim_open`, it
  falls out of that query entirely — there's no flag to check, no pause to
  apply, the order is simply no longer inside the set the timer looks at.
- Both writes are the same compare-and-swap pattern (`update ... where id =
  $1 and state = $2`) — if a claim is filed in the same instant the timer
  fires, exactly one of the two `UPDATE`s actually changes a row (whichever
  reaches Postgres first), and the other returns zero rows affected and is
  treated as "someone else already moved this order," not an error. There is
  no window where both a release and a claim can win.

**Recommended, not required**: a regression test asserting exactly this race
— open a claim and let the worker's release query run in the same tick,
assert the order ends up in `claim_open`, never `released` — would make this
guarantee explicit rather than implicit in the state machine's shape. Worth
adding whenever `internal/order`/`internal/dispute` next gets a test suite
pass, not blocking anything else in this plan.

---

## 5. The wallet's greyed-out pending amount — already built, confirmed

> The minute a seller sells an item, then the wallet area of the seller will
> have the greyed out {amount} which is the potential amount that will
> eventually be released... combined of all potential funds, and slowly
> release them to the wallet whenever each transaction has completed fully.

**This exists today, exactly as described.** `internal/payout.GetSummary`
returns:

- `AvailableCents` — every `released` order not yet paid out (what the
  Withdraw buttons actually send).
- `PendingCents` — the sum of every order a seller has sold that's genuinely
  paid for but hasn't reached `released` yet (`paid`, `awaiting_ship`,
  `shipped`, `delivered`, `claim_window`, `claim_open`) — combined across
  every in-flight sale, exactly the "slowly release as each one completes"
  behavior described.

`apps/web/components/WithdrawPanel.tsx` renders this today as the big
available number with a smaller greyed-out `+$X` next to it, captioned "the
greyed-out amount is from sales still in progress... and isn't withdrawable
yet." **No build step needed here** — flagging it so it doesn't get
accidentally rebuilt from scratch, and so the language above ("wallet") is
recognized as already matching the product, not a new concept.

---

## 6. A 70/30 split as a one-click claim resolution

> I want the ability for the seller and the buyer to Resolve their Issue by
> doing a 70-30% refund if the order was not described exactly... they can
> request a full refund, or a "70-30 Split" — 30% goes back to the buyer and
> the seller makes 70%.

**Good news: the backend primitive for this already exists and needs zero
new endpoints.** `internal/dispute.ProposePartialRefund`/
`AcceptPartialRefund` already let either party propose an arbitrary refund
amount during negotiation and the other accept it in one click
(`claim_events.kind = 'partial_refund_offer'`, wired to
`POST /claims/{id}/partial-refund-offer` / `-accept`). A "70/30 split" is
just that same mechanic with `amountCents` pre-computed as 30% of the order's
`chargedCents`, instead of a buyer typing an arbitrary dollar figure.

### 6.1 What to actually build

- **Frontend only, in `ClaimPanel.tsx`'s `ClaimThread`**: alongside the
  existing free-text "Propose 'keep it, refund X'" input, add two quick-pick
  buttons, shown specifically when `claim.reasonCode === "not_as_described"`:
  - **"Offer 70/30 split (keep the card, get 30% back)"** → calls the
    existing `proposePartialRefund(claim.id, Math.round(chargedCents * 0.30))`
    — no new API call, just a pre-filled amount.
  - **"Request full refund"** → calls the same `proposePartialRefund` with
    `amountCents = chargedCents` (the full charged amount). This is
    functionally a full refund achieved through the partial-refund
    mechanism, not a separate code path — see §6.2 for why that's a nuance
    worth deciding on, not silently accepting.
- `ClaimDetail`'s API response needs the order's `chargedCents` available to
  compute these amounts client-side (check `lib/api.ts`'s `ClaimDetail`
  type — if it isn't already threaded through, add it; the backend already
  has this value on the order row).

### 6.2 One real inconsistency this surfaces, worth a decision

`AcceptPartialRefund` always transitions the order to `released` (not
`refunded`), regardless of the refund amount — because right now every
partial refund is, definitionally, partial: the seller keeps something. Once
a "request full refund" quick-pick makes a **100%** partial refund a normal
negotiated outcome, an order can reach `released` with the seller's net
proceeds at zero, which is financially identical to `refunded` but reported
under a different state.

Two ways to resolve this, either is a small, contained change once decided:

1. **Leave it as `released`.** Simplest — no code change. Reporting/metrics
   that assume "released implies the seller got paid something" would need
   to account for a $0 released order, which is a minor gotcha, not a bug.
2. **Special-case it**: if `AcceptPartialRefund`'s amount equals the order's
   full `chargedCents` (minus anything already refunded), route to
   `refunded` instead of `released`, and skip the `ReleaseFunds`/Transfer
   call entirely (there's nothing left to transfer). This keeps `refunded`
   meaning exactly "buyer got 100% back" everywhere, not just via the
   auto-adjudication/human-decision paths.

Recommend (2) — it keeps one state meaning one thing consistently across
every path that can produce it, matching this codebase's existing "one state
machine, not scattered meaning" convention — but it's a small enough
divergence that (1) is a legitimate launch-now, fix-later choice too.

### 6.3 Reason-code scoping

The walkthrough frames the 70/30 split specifically around "item not as
described." Recommend *not* hard-restricting the quick-pick buttons to that
one reason code in the backend (the underlying propose/accept calls don't
care why a claim was opened) — but defaulting the frontend to show these
buttons prominently for `not_as_described` claims specifically, since that's
the scenario where "buyer keeps a real, physical, already-shipped item at a
discount" cleanly resolves the dispute. For "never arrived" claims, a 70/30
split doesn't make the same sense (there's no item to keep) — the UI should
keep showing the free-text partial-refund input there instead, not the
quick-picks.

---

## 7. Suggested build order

1. **§3 (flat 48h window)** — smallest, most contained change; do this first
   since §1's leading bubble and §2's payment deadline both build on top of
   an already-correct claim-window number.
2. **§6 (70/30 quick-resolve)** — frontend-only, no backend risk, immediately
   useful regardless of anything else in this doc.
3. **§1 (leading "Sold" bubble)** — trivial once §2 exists to give it a real
   duration; can ship cosmetically early with `created` if §2 is deferred,
   just without a countdown.
4. **§2 (24h payment deadline)** — the biggest item here: needs the open
   relist/second-chance-offer product decision made first (§2.1), a new
   migration, a new worker timer, and UI for the countdown.

Everything above is additive to the order/claim state machines that already
exist — none of it requires a migration that touches existing rows
destructively, and none of it changes `pkg/fees`' commission math at all.
