# Buyer & Seller Guarantee Plan

**Status:** working draft — a first pass at turning what's *already running in code*
into a real, publishable Buyer Guarantee / Seller Protection policy, plus the gaps
that need a decision or a build before it's honest to publish. Not legal advice, not
final copy, not yet reviewed by counsel (see §7).

**Why this doc exists:** `docs/PercentageModel.md` sets the fee model but only
sketches coverage in one table (§9) and explicitly says "we don't offer eBay-style
unconditional buyer protection." That's still true. But the question that prompted
this doc — *can we actually hold money and give it back to a buyer who never got
their card* — turns out to already be answered "yes, and it's built," not "someday,
pending Stripe." The real gap isn't capability, it's that no one has written down,
in one place, exactly what's covered, exactly how long money sits where, and exactly
which parts of the existing coverage table are real automated rules vs. "a human
decides." That's this doc.

---

## 0. The one fact everything below depends on

**`docs/PercentageModel.md` and `CLAUDE.md` both describe the payment architecture as
Stripe Connect *direct charges* — "money goes straight to the seller's own Stripe
account, never a platform-held balance." That is no longer what the code does.**

The actual, shipped implementation (`apps/api/internal/payment/payment.go`,
`internal/order/release.go`, confirmed against `docs/Legal_MoneyTransitter.md`) is
**separate charges and transfers**:

1. A buyer's charge (`PaymentIntent`) is created and captured on the **platform's
   own** Stripe account — not the seller's connected account.
2. The money sits in the **platform's** Stripe balance for the entire life of the
   order — through `awaiting_ship`, `shipped`, `delivered`, `claim_window`, and
   `claim_open` if a claim gets filed.
3. Only when an order reaches `released` does `order.ReleaseFunds` fire a real
   Stripe `Transfer` — moving money from the platform's balance into the seller's
   *connected account balance* (`internal/order/release.go:33-70`).
4. Only later, when the seller actively clicks "Withdraw" (or a scheduled batch —
   not yet wired, see §6), does a separate `Payout` move money from the seller's
   connected balance to their actual bank account (`internal/payout/payout.go`).

This is a materially different — and materially *more* guarantee-friendly —
architecture than what the top-level docs describe, for one concrete reason: **a
refund never has to be clawed back from a seller who already got paid**, because the
seller was never paid in the first place until the hold cleared.
`executeFullRefund`/`executePartialRefund` (`internal/dispute/claim.go:416-449`)
refund the *platform's own charge* — there is nothing to claw back, because nothing
was ever transferred out. Compare that to a true direct-charge model, where a refund
after payout means the platform has to either debit the seller's Stripe balance
(which can go negative) or eat the loss itself.

**Two things this changes that the canonical docs need to catch up on:**

- **A real cardholder chargeback (as opposed to a buyer opening a claim in our own
  UI) now lands entirely on the platform's Stripe balance, not the seller's.**
  `CLAUDE.md` §7's whole "negative connected-account balance" worry was written for
  the direct-charge model. Under separate-charges-and-transfers it doesn't apply the
  same way — but a new, undocumented risk replaces it: **there is currently no
  `charge.dispute.*` webhook handler at all** (`internal/webhook/webhook.go` only
  handles `account.updated`, `payout.paid/failed`, and the two `payment_intent.*`
  events). A real chargeback today does not touch `orders.state`, does not notify
  anyone, and does not get reconciled against an already-`released`/transferred
  order. This is a genuine, unflagged gap — see §6.2.
- **`application_fee_amount` (PercentageModel.md §8's sales-tax sweep-back
  mechanism) is not used anywhere in the code.** It's a direct-charge concept; it has
  no equivalent under separate-charges-and-transfers, where the platform holds the
  whole charge (tax included) itself until release. This isn't a bug, but
  PercentageModel.md §8 needs a rewrite once this doc's numbers are accepted, not
  just this doc.

I'm treating the **code's actual behavior as ground truth** for everything below,
not either markdown doc. Where PercentageModel.md's numbers still hold (the fee
ladder, the $50 small-claim threshold, the 3–7 day claim window), I've cited both.

---

## 1. How the hold actually works today — the real mechanics

### 1.1 Order state machine (`internal/order/order.go`)

```
created → payment_pending → paid → awaiting_ship → shipped → delivered
                                                        │
                                    ┌───────────────────┴──────────────┐
                                    ▼                                  ▼
                              claim_window                       released
                              (standard sellers)              (Gold/Hous Trust:
                                    │                          instant on scan)
                       ┌────────────┴────────────┐
                       ▼                          ▼
                  released                   claim_open
              (window elapsed,           ┌────────┴────────┐
               no claim filed)           ▼                 ▼
                                     released           refunded
                                (deny / partial /   (full refund /
                                 negotiated settle)  auto-adjudicated)
```

Money-relevant timers actually running today (`cmd/worker/order_timers.go`,
`cmd/worker/claim_timer.go`), all on a 1-minute (order) / 15-minute (claim) poll:

| Timer | Trigger | Effect | Code |
|---|---|---|---|
| **Ship deadline** | 72h in `awaiting_ship` with no tracking uploaded | Auto-cancel, full refund | `order_timers.go:46-55` |
| **No-scan refund** | 21 days in `shipped` with no delivery scan | Auto-refund (protects buyer from a lost/never-shipped package with a dead tracking number) | `order_timers.go:89-95` |
| **Claim window** | Delivery confirmed | 3 days (orders **under $250**) or 7 days (**$250+**) before auto-release, unless a claim is filed first | `order/fulfillment.go:147-215`, threshold `highValueThresholdCents = 25000` |
| **Trusted release** | Delivery confirmed, seller is Gold or Hous Trust tier | Skips the claim window entirely — released the instant the carrier scans it delivered | `order/fulfillment.go:179-203` — **currently dead in practice, see §6.1** |
| **Negotiation → escalation** | 48h in a claim's `negotiating` state with no resolution | Auto-escalates to auto-adjudication or human review | `claim_timer.go:15-17` |

These numbers **do not match `docs/design-doc.md` §3** (24h tracked / 6-business-day
PWE / 3-business-day ship deadline) — that doc is the stale "v1" wallet-era design.
They're closer to, but not identical to, `PercentageModel.md`'s "3–7 day claim
window" language. Treat the table above as the actual policy; if it needs to change,
change the code and this doc together, not design-doc.md.

### 1.2 What this means for "how long can we hold the money"

You asked specifically how long Stripe lets you hold funds before you're forced to
either pay out or refund. Two different Stripe mechanisms are relevant, and **only
one of them is actually what this codebase uses**:

- **Manual payout scheduling on a connected account** (delay payouts to a seller's
  *bank account* once money is already in their Stripe balance): Stripe holds it
  until you trigger a payout, up to **2 years for US accounts**, 90 days elsewhere.
  This is what you'd need under a **direct-charge** model, where money lands in the
  seller's balance immediately and the only lever you have is delaying when it
  reaches their bank. **This is not the lever this codebase uses**, because it isn't
  on a direct-charge model.
- **What the code actually does**: the platform simply doesn't call `Transfer` yet.
  Money sits in the *platform's own* Stripe balance — completely ordinary, no
  special Stripe configuration required, no country-specific ceiling, because it's
  not "held funds" from Stripe's point of view at all, it's just an ordinary account
  balance the platform hasn't moved yet. The 3–7 day claim window is a **business
  rule enforced by your own worker timers**, not a Stripe-imposed constraint in
  either direction.

Practically: **you are not constrained by Stripe's payout-hold ceilings at all** for
the buyer-guarantee mechanism as currently built. The real constraint is the one
`docs/Legal_MoneyTransitter.md` already raises — the hold needs to stay "bounded and
tied to an objective, transaction-completing trigger" to keep the money-transmitter
exemption argument intact. A 3–7 day, delivery-triggered window is squarely inside
that; an indefinite or discretionary hold would not be.

### 1.3 Stripe's own words on this, worth having verbatim for the eventual legal review

> "*Escrow* has a precise legal definition, and Stripe doesn't provide escrow
> services or support escrow accounts. However, you can control payout timing
> through manual payouts, which allow you to delay payouts to certain accounts...
> Use delayed payouts when a delivery is delayed or when you think you have a
> possibility of a refund."
> — [Stripe: Using manual payouts](https://docs.stripe.com/connect/manual-payouts)

This is Stripe telling platforms, in its own docs, that a delay mechanism ≠ a legal
escrow product, and that the regulatory characterization is on the platform. Same
point `Legal_MoneyTransitter.md` §4 already makes — worth keeping "claim window" /
"hold" as the vocabulary in any public-facing guarantee copy, never "escrow."

---

## 2. The Buyer Guarantee — what's covered today, reconciled against what's automated

`PercentageModel.md` §9's table is the closest thing to a public coverage promise
that exists. Reconciled against `internal/dispute/claim.go`'s actual
`autoAdjudicate` function (the only part of the coverage table that runs without a
human):

| Scenario | PercentageModel.md §9 says | What's actually automated | Gap |
|---|---|---|---|
| Item not as described | Seller liable | **Not automated** — always `human_review` | No image-comparison infra; correctly routed to a human with both photos, per `claim.go:296-306`'s own comment |
| "Never arrived," no tracking exists | Seller liable | **Automated**: refund buyer, seller liable | None — matches exactly |
| "Never arrived," tracking shows delivered, order **under $50** | Platform absorbs | **Automated**: refund buyer, platform absorbs | None — matches exactly (`smallClaimThresholdCents = 5000`) |
| Same, order **$50+** | Buyer, with fraud review first | **Not automated** — falls to `human_review` | Consistent with "fraud review," just means every $50+ no-delivery claim currently costs a human review cycle |
| Payment fraud / stolen card | Platform | **Not automated** — falls to `human_review` | No `ReasonPaymentFraud` rule in `autoAdjudicate` at all |
| Buyer's remorse | Not covered — buyer eats it | **Not automated** — falls to `human_review`, same as everything else | **Should be an instant auto-deny, not a human-review queue item** — see §6.3 |
| Item damaged in transit, seller has adequate packing evidence | Platform, up to **$100** | **Not automated**, no $100 cap enforced anywhere in code | A human reviewer decides the amount today with no system-enforced ceiling — see §6.3 |

**Net finding: 2 of 7 rows in your own stated coverage policy are actually
automated.** Everything else already works — it just costs a human review cycle
(and, per `claim.go:266-282`, fires a real `support@` email every time) rather than
resolving instantly. That's a fine place to launch from, but it's worth knowing
precisely which promises are "instant" and which are "you'll hear back after
someone looks," because those are different UX promises to a buyer.

### 2.1 The buyer-side timeline as it should be described publicly

1. **Delivery confirmed** → a 3-day (orders under $250) or 7-day ($250+) window
   opens automatically. Nothing to do if the item's fine.
2. **File a claim inside that window** → 48 hours of direct negotiation with the
   seller (message thread, evidence upload, propose/accept a partial refund).
3. **Unresolved after 48h** → auto-escalates. Either an instant automated decision
   (2 of the 7 scenarios above) or a human review, notified within the same
   escalation event.
4. **Decision rendered** → full refund, partial refund, or denial, executed as a
   real Stripe refund against the original charge — same charge the buyer's card
   statement already shows, no separate "wallet credit."
5. **One appeal**, different reviewer, final (`claim.go:451-525`) — no published
   window on how long a buyer/seller has to file it today; design-doc.md's 30-day
   eBay-style number was never carried into v2 (see §7, open question 1).

### 2.2 What's genuinely *not* covered, and should say so plainly

Per `PercentageModel.md` §9, unchanged: buyer's remorse is not covered. This plan
doesn't propose changing that — thin margins can't fund an unconditional
return policy — but recommends the claim UI say so *before* a buyer wastes a
48-hour negotiation window filing one (see §6.3).

---

## 3. The Seller Guarantee — what protects a seller from a bad-faith buyer

This side gets less attention in the existing docs but the mechanics are real:

- **Evidence-gated shipping.** A seller cannot mark an order `shipped` without
  uploading card-front, card-back, and sealed-package photos first
  (`order/fulfillment.go:28-107`, `CanTransitionToShipped`). This is exactly the
  Whatnot-precedent packaging-photo requirement `docs/Shipping_Research.md` §4
  recommended, and it's already load-bearing dispute evidence, not just a nice-to-have.
- **Tracking is the seller's alibi.** The "no tracking + never arrived → seller
  liable" auto-rule cuts the other way too: a seller who *did* upload real tracking
  and the carrier shows delivered is never automatically found liable for a "never
  arrived" claim — that scenario either resolves in the seller's favor
  (small-claim, platform absorbs) or goes to a human, never an automatic loss.
- **One appeal, guaranteed.** A seller found liable by an automated rule or a first
  human reviewer gets exactly one shot at a different reviewer
  (`dispute.Appeal`/`DecideAppeal`) — this exists and works today.
- **Signature confirmation above $500** (`internal/shipping/tier.go:37-52`) —
  stricter than eBay's $750 line, gives an objective delivery-confirmation bar for
  exactly the claims most likely to be contested (high-value slabs).
- **Trusted-tier instant release** — Gold/Hous Trust sellers skip the claim window
  entirely. **This currently never fires for anyone** (§6.1) but the mechanism is
  real and wired, waiting only on the tier-promotion job.
- **Partial-refund tool** — either side can propose "keep it, take X% back"
  (`ProposePartialRefund`/`AcceptPartialRefund`), closing most condition disputes in
  minutes without a full return destroying the sale for a low-value card — this is
  real, works today, and is the main thing keeping most claims out of the
  human-review queue at all.

**What does *not* yet protect a seller:** nothing in the current code checks a
buyer's dispute history before letting them open another claim, and nothing rate-
limits repeat claims from the same buyer. Not a blocker for launch, but worth naming
as a real seller-protection gap alongside the buyer-side gaps in §6.

---

## 4. Financial exposure — what this actually costs, reconciled

`PercentageModel.md` §9's budget assumption (0.4% baseline dispute rate × each
tier's modeled risk multiplier, $15 flat Stripe dispute fee) is unchanged by any of
this — that's a modeling exercise, not something the architecture shift affects.

**What the architecture shift *does* change: who's actually on the hook for a real
chargeback, and when.**

Under separate charges and transfers:
- **Before release/transfer**: a chargeback debits the platform's own Stripe
  balance. The order's money was never anywhere else. Clean.
- **After release/transfer**: the money has already moved to the seller's connected
  account. A chargeback landing *after* this point (a card network dispute can be
  filed up to ~120 days after the original charge, well past any 3–7 day claim
  window) hits the **platform's balance directly** for the disputed amount — Stripe
  doesn't reach into the connected account to claw back an already-completed
  Transfer automatically. Today, **nothing in the code reacts to this at all** (see
  §6.2) — no order state change, no seller-side clawback, no accounting entry.
  This is the sharpest actual financial exposure this doc surfaces: real chargebacks
  on already-paid-out orders are currently invisible to the system.

This is a different shape of risk than `CLAUDE.md` §7's "connected account negative
balance" worry (written for a direct-charge model where the seller's own balance
takes the hit) — it needs its own line in the eventual legal/risk review, not a
reuse of that section's reasoning.

---

## 5. Proposed public-facing guarantee language (draft — not final copy)

Two short policies, meant to sit at checkout and on a `/guarantee` page, in the same
plain-spoken register as `PercentageModel.md`'s own "brand promise is transparency"
framing.

> ### AuctionHous Buyer Guarantee
> Every purchase is protected from the moment you pay until a few days after it
> arrives. Here's exactly how it works, no fine print:
> - Your payment is held by AuctionHous, not the seller, until your claim window
>   closes or you accept the item.
> - **Standard items:** claim window is 3 days after delivery is confirmed.
>   **Items $250 and up:** 7 days.
> - If something's wrong — never arrived, not as described, arrived damaged — open
>   a claim before the window closes. Message the seller directly first; most
>   issues resolve in minutes with a partial refund, no return needed.
> - If you can't work it out in 48 hours, we step in. Clear-cut cases (package
>   never scanned as shipped, tracking shows it never left the seller) are refunded
>   automatically. Everything else gets a human review, and you'll hear back with a
>   real decision, not a form letter.
> - One thing we don't cover: changing your mind after the item shows up exactly as
>   described. We keep fees low by not funding no-fault returns — same reason
>   TCGplayer/eBay-style buyer protection isn't unconditional here either.

> ### AuctionHous Seller Protection
> - You get paid the moment your claim window closes with no claim filed — no
>   waiting on us to "release" anything manually.
> - Upload your shipping photos (card front, back, sealed package) before you mark
>   an item shipped, and you have real evidence on record if a buyer disputes
>   condition later.
> - Ship with tracking and a delivery scan, and a "never arrived" claim can't
>   automatically go against you.
> - Every decision — automated or human — comes with one appeal to a different
>   reviewer before it's final.
> - Reach Gold or Hous Trust tier and skip the claim window entirely: paid the
>   instant the carrier scans your package delivered.

**This copy assumes §6's gaps get closed before it goes live** — in particular, the
buyer's-remorse line above is only honest once that path actually auto-denies
instead of sitting in a human queue (§6.3), and the tier-benefit line is only true
once tier promotion actually runs (§6.1).

---

## 6. Gaps to close before this is safe to publish as-is

### 6.1 Tier promotion doesn't exist yet, so "Gold/Hous Trust" benefits never trigger

`seller.CurrentTier` always returns `'new'` — there's no promotion/demotion job
(`internal/seller/tier.go:38-45`'s own comment: "Phase 7 scope, not built yet").
The trusted-release code path in `MarkDelivered` is real and correct, but
unreachable in practice. **Don't publish "reach Gold, skip the wait" copy until the
tier-recompute worker exists** (`cmd/worker/tier_recompute.go` exists as a file —
worth checking whether it's a stub or actually wired before assuming it's close).

### 6.2 No chargeback webhook handler exists

`internal/webhook/webhook.go` has no `charge.dispute.created` /
`charge.dispute.closed` case. A real cardholder chargeback today is invisible to
`orders.state` — it doesn't move an order to `refunded`, doesn't notify anyone,
and doesn't get reconciled against a `released` order whose funds already
transferred out. This is the single most important gap relative to what this doc
is about (the buyer's actual money-back guarantee) — recommend this be the next
concrete build, not a someday item, given it's a real gap in real money-back
capability, not just documentation debt.

### 6.3 Two coverage-table rows are costing human review cycles for no reason

- **Buyer's remorse** should be an instant `deny`, matching the plainly-stated
  policy ("not covered at all") — currently it silently falls through to
  `human_review` in `autoAdjudicate`'s default case, costing a support email and a
  human decision for an outcome that's already decided by policy.
- **Transit damage under some cap** could plausibly auto-resolve up to the stated
  $100 platform-absorbed ceiling from `PercentageModel.md` §9, the same way the
  $50 no-delivery rule already does — worth a second auto-rule once photo evidence
  (already required at ship time) is judged sufficient to auto-approve small claims.

### 6.4 design-doc.md §4.2's fraud/freeze rules were never carried into the real code

- **Bad Actor Threshold** (2 disputes/30 days → listing suspension): not
  implemented anywhere in `internal/seller`.
- **New-account withdrawal delay** (5 business days after first sale before first
  bank withdrawal): not implemented in `internal/payout`.

Neither blocks the buyer-guarantee mechanism itself, but both are named,
specific anti-fraud commitments in an existing doc that currently don't exist in
code — worth either building or explicitly striking from the docs so nothing is
promised that isn't real.

### 6.5 Canonical docs need a rewrite, not just this new file

`PercentageModel.md` §6–§9 and `CLAUDE.md` §5.1/§7 describe direct charges. Once
this doc's framing is accepted, those sections need the same "supersedes" treatment
`PercentageModel.md` itself gave to `design-doc.md` — otherwise there will be three
documents describing three different money-flow architectures, which is exactly the
kind of drift `Legal_MoneyTransitter.md` warns a reviewing attorney needs a single
accurate fund-flow diagram to evaluate, not three conflicting ones.

---

## 7. Open decisions — yours, not resolved here

1. **Appeal window length.** Neither `design-doc.md`'s 30-day eBay number nor
   `PercentageModel.md`'s "7–10 days, your call" was ever actually encoded —
   `claim.go`'s `Appeal` has no deadline check at all today. Needs a number and a
   worker timer (mirrors `claim_timer.go`'s existing shape).
2. **The $100 transit-damage cap and the buyer's-remorse auto-deny** (§6.3) — do you
   want these as real auto-rules now, or left as human-review judgment calls for a
   while longer to see how claim volume actually looks?
3. **Chargeback handling (§6.2)** — build the webhook handler before or after real
   money goes live? Given it's the actual mechanism protecting the platform's own
   balance, recommend before.
4. **Legal review**, per `Legal_MoneyTransitter.md`'s own closing section — this
   doc's fund-flow description (§0–§1) is exactly the diagram that review needs, and
   nothing here should be read as clearing that review, only as making it possible
   to have with an accurate starting document.
5. **Launch-tier override** (`PercentageModel.md` §10.1, plan doc §3.7) — still
   open, and now also gates whether "reach Gold, skip the wait" copy (§5) can ever
   be true for an early seller within a reasonable time.
