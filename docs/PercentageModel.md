# The Percentage Model — every financial decision, in one place

**Status:** describes the payment/fee architecture as actually shipped in code
today — Stripe Connect **separate charges and transfers** (not direct charges
— see the correction at the end of §6 and the note at the end of this file for
why that matters and what changed). Supersedes the flat-2%/wallet-based model
in `docs/design-doc.md` ("v1"). Cross-reference: `docs/Legal_MoneyTransitter.md`
(the money-transmitter research this hold design was built against) and
`docs/BuyerSellerGuarantee.md` (the buyer/seller coverage policy built on top
of everything in this file). Where this file describes a number or mechanism,
it's describing what's actually running (`apps/api/internal/order`,
`internal/payment`, `internal/payout`, `internal/dispute`, `internal/chargeback`),
verified against that code directly — not a design intention.

**Audience:** anyone who needs to answer "why is the fee X%" or "where does
this dollar go" without reading the full engineering plan. This file explains
*decisions*, not code — for the implementation, see
`/Users/alexparks/.claude/plans/giggly-marinating-gem.md`.

**The one rule everything below serves:** the brand promise is transparency.
Nothing in this model is allowed to be a hidden line item — every fee, every
discount, every tier rate is something a buyer or seller can see plainly
before money moves.

---

## 1. The constants, and why each one is what it is

```
FEE_FIX     = $0.30   — flat, on every order, both payment rails, all tiers
CARD_PCT    = 2.9%    — Stripe's card processing cost (pass-through, not ours)
CARD_FIXED  = $0.30   — Stripe's card processing fixed cost (pass-through)
ACH_PCT     = 0.8%    — Stripe's ACH processing cost, capped
ACH_CAP     = $5.00   — ACH processing cost never exceeds this per order
BUYER_SHARE = 70%     — the buyer's cut of what we save by routing to ACH
```

**Why $0.30 applies to every order, with no minimum-order exemption:** a
threshold (e.g. "free under $20") creates a cliff — a seller nets *more* at
$20.01 than at $19.99, which is a bug dressed up as a rule. Sellers find that
cliff within a week and bunch listings right above it. Flat is the only
version of this that can't be gamed.

**Why the fee base is `item price + shipping`, and never sales tax:**
shipping is money the seller actually receives for doing something (packing,
mailing) — feeing it is fair and matches how eBay already does it. Tax is not
our money at any point; it passes through to a state government. We eat the
~2.9% card-processing cost on the tax portion ourselves (about 0.25% of GMV)
rather than fee something that was never ours. This is meant to be said
publicly, as a contrast: *eBay charges its final-value fee on collected sales
tax. We don't.*

---

## 2. What a seller pays: the fee formula

```
fee_base    = item_price + shipping
seller_fee  = round(fee_base × tier_rate) + $0.30
seller_net  = fee_base − seller_fee
```

`tier_rate` is not one number — it's a function of seller standing (§4 below).
**Critically: `seller_fee`/`seller_net` are computed once, from the original
item price and shipping, and never change based on how the buyer pays.** A
buyer choosing the cheaper bank-payment rail does not cost the seller a cent
— that discount comes entirely out of platform margin, never seller net. This
is a hard invariant, not a rounding coincidence: it's what makes "your net is
the same either way" a promise we can actually keep to sellers.

### Worked examples — Gold tier (6.00%), no shipping, no tax

| Item price | Seller fee | Seller nets |
|---|---|---|
| $2 | $0.42 | $1.58 |
| $5 | $0.60 | $4.40 |
| $10 | $0.90 | $9.10 |
| $25 | $1.80 | $23.20 |
| $50 | $3.30 | $46.70 |
| $100 | $6.30 | $93.70 |
| $250 | $15.30 | $234.70 |
| $500 | $30.30 | $469.70 |

Card margin (our profit on the card rail) is exactly `(tier_rate − 2.9%) ×
fee_base` — if a real implementation ever produces a different number, the
bug is in how the fixed $0.30/$0.30 fees are being handled, not in the
percentage math.

---

## 3. What a buyer pays: two prices, one honest difference

A buyer sees **two prices at checkout**, never one:

> Total: **$113.66** (pay by card)
> Pay by bank instead — **$111.63** (save $2.03)

**The card price is the real, displayed price everywhere else on the site** —
listing pages, search results, everywhere except the checkout screen itself.
The bank price only ever appears as a *savings offer* at the moment of
payment. This ordering is deliberate and legally load-bearing: presenting the
bank price as the "real" price and adding a card fee on top would legally be
a *surcharge* — capped at 3% nationwide, banned outright in Connecticut,
Maine, and Massachusetts, and prohibited on debit cards everywhere. Presenting
the bank price as a **discount off the card price** avoids all of that. This
is not a cosmetic choice; it is a compliance boundary.

**Hard copy rules, non-negotiable:**
- Never call the difference a "fee," "surcharge," or "card fee" anywhere.
- Never lead with the bank price on a listing page.
- The realized savings shown to the buyer must be the *actual total
  difference* (card total minus bank total) — not just the discount amount
  computed on goods, because a lower goods price also means lower tax, and
  that second-order savings is real money the buyer should see credited.

### Why the buyer only gets 70% of the processing saving, not 100%

Routing a payment through ACH instead of card saves real processing cost
(2.9%+$0.30 vs. 0.8% capped at $5). We pass **70% of that saved cost** to the
buyer as a visible discount and keep 30% as platform margin. This is why the
bank rail is *simultaneously* cheaper for the buyer and more profitable for
us than the card rail — see §7 for why that matters more than it sounds like
it should.

### The order of operations matters — this is the part most likely to be built wrong

The discount is applied to the **goods price**, and tax is **recomputed from
scratch** on the discounted amount — never computed once and then scaled down
proportionally.

```
CARD RAIL:
  card_tax   = tax on (subtotal + shipping)          ← real tax, via Stripe Tax
  card_total = subtotal + shipping + card_tax

BANK RAIL:
  discount    = 70% × (card processing cost − ACH processing cost)
  bank_goods  = subtotal − discount
  bank_tax    = tax on (bank_goods + shipping)        ← recomputed, not scaled
  bank_total  = bank_goods + shipping + bank_tax
```

If you instead computed tax once on the card total and just multiplied it
down for the bank rail, you'd be charging a plausible-looking but *wrong* tax
amount — and remitting the wrong amount to a state government. That's not a
rounding bug, it's a compliance problem. Recomputing tax from the actual
discounted sale price is the only version of this that's legally correct.

### Four things that must always be true (the financial invariants)

1. **A seller's net proceeds are identical no matter which rail the buyer
   picked.** (Already stated above — restated because it's the single most
   important promise in this whole model.)
2. **The tax we charge the buyer is always exactly the tax Stripe Tax
   calculated — to the cent.** Never padded, rounded up, or used as a buffer
   for anything. Charging a buyer a dollar amount labeled "tax" that doesn't
   match what actually gets remitted is the kind of thing state attorneys
   general have specific statutes about.
3. **Our margin on the bank rail is always at least as good as our margin on
   the card rail.** (True by construction, since we only give away 70% of a
   saving, not all of it.)
4. **The bank total is always less than the card total**, whenever there's an
   actual processing-cost saving to share. If it's ever not cheaper, the
   "discount" isn't a discount and shouldn't be offered.

### Worked example across tiers — $100 item + $5 shipping + 8.25% sales tax

Buyer pays **$113.66** by card, **$111.63** by bank — saves **$2.03**,
regardless of tier (the tier only changes what the seller nets, never what
the buyer sees).

| Tier | Rate | Seller fee | Seller nets |
|---|---|---|---|
| New | 7.00% | $7.65 | $97.35 |
| Bronze | 6.50% | $7.13 | $97.87 |
| Silver | 6.25% | $6.86 | $98.14 |
| Gold | 6.00% | $6.60 | $98.40 |
| Platinum | 5.50% | $6.08 | $98.92 |
| Hous Trust | Custom — varies per seller, not a fixed rate (§4.6) | — | — |

---

## 4. Seller trust tiers — why the fee rate isn't flat

**This whole section is real, running code as of this pass** — not a design
target. `internal/seller/promotion.go`'s `RecomputeTier`/`RecomputeAllTiers`
run daily (`cmd/worker`), recomputing every seller's standing from scratch
and writing a `tier_events` audit row on every change. Nothing in §4 below is
aspirational; every number is exactly what's enforced in code today.

### 4.1 The ladder

**Six tiers, not five — Platinum sits between Gold and Hous Trust.** Platinum
is exactly what "Hous Trust" used to describe (500-order threshold, fixed
5.50% rate) before Hous Trust became its own tier above it — reached only
through a real application, never order volume alone, with a commission rate
negotiated per seller instead of a shared constant. See §4.6.

| Tier | Rate | Reached at (cumulative completed orders) | Modeled dispute risk vs. average |
|---|---|---|---|
| New | 7.00% + $0.30 | 0–14 | 3.0× |
| Bronze | 6.50% + $0.30 | 15–49 | 2.0× |
| Silver | 6.25% + $0.30 | 50–149 | 1.2× |
| Gold | 6.00% + $0.30 | 150–499 | 0.8× |
| Platinum | 5.50% + $0.30 | 500+ | 0.5× |
| Hous Trust | **Custom + $0.30** — negotiated per seller at application, not fixed | Application only — never by volume | N/A — underwritten per seller, not modeled against an average |

**Gold, not New, is the number we lead with in marketing** ("6% + $0.30" is
the headline rate quoted against eBay's ~13.6%). Platinum's 5.50% is
something a seller earns through volume and standing; Hous Trust is
something else again — invited, not simply reached.

**Why new sellers pay the most, not the least:** this is risk-based pricing,
not a penalty. New sellers generate roughly 3× the dispute rate of an
established seller in our modeling — the higher rate for a New-tier seller
collects more in fees than the excess dispute/chargeback risk costs us. It's
the same logic an insurer uses for a new driver, applied to marketplace risk.

**Why the thresholds are 15/50/150/500 and not something rounder:** thresholds
set on instinct (50/200/750/2500, for instance) leave the median seller
(who does about 33 orders a year, per our modeling) permanently stuck in the
worst tier, with 97% of marketplace volume paying above the rate we advertise
— which is a stealth price increase wearing a loyalty-program costume, on a
platform whose whole premise is fee honesty. At 15/50/150/500: roughly 97% of
sellers reach Bronze, about 31% reach Silver, and Platinum stays genuinely
aspirational (~2% of sellers) rather than a rate nobody actually pays. Hous
Trust sits above even that, and isn't sized as a percentage of the seller
base at all — see §4.6.

### 4.2 Everything required to actually get promoted, tier by tier (New through Platinum)

This section is the automatic ladder — New, Bronze, Silver, Gold, Platinum.
**Hous Trust is not part of it; §4.6 covers that separately.** Order count
alone is never enough to reach any of these five — **all** of the following
must hold at the moment a seller's standing is recomputed, or the promotion
simply doesn't happen that pass (it isn't lost, just retried the next day):

- The order-count threshold for the target tier (§4.1's table)
- Dispute rate under **2%** over the trailing 90 days (claims filed against
  this seller's orders ÷ this seller's own orders in that window)
- No unresolved claim older than **7 days**
- Account age of at least **14 days**
- **A review-quality floor, scaled to the target tier** — the higher the
  tier, the more reviews and the better they need to be:

  | Target tier | Minimum reviews | Minimum average rating |
  |---|---|---|
  | Bronze | 5 | 4.0 / 5.0 |
  | Silver | 15 | 4.3 / 5.0 |
  | Gold | 40 | 4.5 / 5.0 |
  | Platinum | 100 | 4.5 / 5.0 |

  The average is across every review a seller has (all three rating axes —
  condition accuracy, shipping speed, trustworthiness — blended), not a
  rolling window the way dispute rate is; a seller doesn't get to "outrun" a
  bad early stretch by generating enough recent good reviews to dilute the
  average back down within 90 days, they have to actually earn it out.

  **This reverses an earlier version of this document's stance** ("deliberately
  not gated on review count," to avoid pressure to solicit reviews). That
  concern is still valid against a raw *count* quota rewarding solicitation —
  it's not valid against a *quality floor* on the reviews a seller already
  organically has, which is the actual gate now: a seller with a hundred sales
  and a mediocre average rating does not get to Gold on volume alone, full
  stop. **Explicit product decision, made because volume-only promotion was
  found to let exactly that scenario through.**

  **A promotion that jumps straight to a higher tier has to clear that
  tier's bar, not an easier one along the way** — a seller whose order count
  alone would qualify them for Gold in one recompute pass (say, the worker
  was down a while) needs Gold's 40-review/4.5 bar, not Bronze's 5-review/4.0
  one, even though technically "some" bar would've passed. Order volume alone
  can never land a seller on Hous Trust this way, no matter how high it
  climbs — the ladder tops out at Platinum; see §4.6 for why and how that's
  actually enforced in code, not just documented as a rule.

### 4.3 New sellers get a floor under how long they can be stuck at the worst rate

A New-tier seller graduates to Bronze automatically at **25 completed orders
or 30 days, whichever comes first** — as long as every gate in §4.2 is clean,
review-quality floor included. This caps the downside for someone taking a
chance on a new platform, and costs us almost nothing, since a brand-new
seller is by definition low-volume — but it is not a bypass of the review
gate: hitting 30 days with a bad review record does not graduate a seller
to Bronze regardless of how long they've waited.

### 4.4 Tiers can go down, not just up

If a seller's trailing-90-day dispute rate exceeds **4%**, they drop one
tier and can't re-promote for 30 days. When this happens, the seller is told
the specific number that triggered it — never a vague "your standing has
changed."

**Demotion is dispute-rate only — a bad review average does not, by itself,
demote a seller today.** It only ever blocks the *next* promotion (§4.2). A
Gold seller whose average rating quietly slides to 3.0 keeps their rate and
tier, as long as their dispute rate stays under 4%, until/unless that's
deliberately extended — flagged here as a real, open gap, not something
resolved by this pass. §10 is the place to record that as an open decision
if it should change.

**Demotion out of Hous Trust drops exactly one tier, same as everywhere
else on the ladder — straight to Platinum, never further.** The seller's
negotiated custom rate is cleared the moment this happens (it was granted
for Hous Trust specifically); if they're approved for Hous Trust again
later, a fresh application grants a fresh rate, never a stale reused one.

### 4.5 Guardrails against gaming the ladder

- Tier is tied to the seller's verified identity from Stripe Connect's
  identity verification (KYC) — not to an email address or a payout account
  — specifically so a seller can't reset a bad standing by opening a new
  account.
- A cancelled or refunded order never counts toward the order total that
  moves someone up the ladder.
- We watch for sellers whose buyers cluster suspiciously on the same payment
  instrument, address, or device — a sign of self-dealing to inflate an
  order count.

### 4.6 Hous Trust: application only, never automatic, no fixed rate

Hous Trust is deliberately outside the automatic ladder §4.2 describes —
nothing in the daily recompute job can ever promote a seller into it, no
matter how many orders they process. Getting in requires all of:

1. **Already at Platinum.** There's no skipping a tier by applying early.
2. **500 reviews, averaging at least 4.5 / 5.0** — the same review-quality
   mechanism as every other tier's gate (§4.2), just a much higher bar,
   fitting the fact that this tier isn't sized as "the next 2% of sellers"
   the way Platinum is — it's meant to be rare.
3. **A real application, decided by a person** — not a threshold check.
   Dispute rate and open-claim age are deliberately *not* auto-checked at
   the "can I apply" gate the way they are for every other tier; they're
   exactly the kind of thing a human reviewer should be weighing directly
   on the application, not a hard wall that silently hides the apply button.
4. **Approval sets a custom commission rate for that seller specifically** —
   "depending on what they are selling," per the product decision behind
   this tier. There is no shared Hous Trust percentage the way every other
   tier has one; `internal/seller.PctForSeller` reads each Hous Trust
   seller's own negotiated rate, set at approval and never reused across
   sellers or re-derived from a formula.

**This is a real, structural difference from the rest of the ladder, not
just a higher bar with extra paperwork** — every other tier is "cross this
line, get promoted automatically, at a rate everyone at that tier shares."
Hous Trust is "apply, get evaluated as an individual, get priced as an
individual." The two coexist in the same `tier_events` audit trail and the
same demotion mechanism (§4.4), but promotion INTO Hous Trust is the one
tier change in this entire system that a human decides case by case.

### 4.7 The one thing we haven't decided yet

At launch, nearly all order volume will sit in the New tier (7% — our worst
rate) at exactly the moment we're competing hardest to attract sellers away
from eBay. Most marketplaces subsidize the early period and monetize later —
worth considering a temporary launch-period override (e.g., every new seller
starts at Silver for the first six months, treated explicitly as a deliberate
customer-acquisition cost rather than a permanent rate change). **This is an
open decision, not yet made** — see §10 item 1 below.

---

## 5. How a buyer pays: card vs. bank

| Rail | What Stripe charges us | How fast it confirms | Guaranteed? | Role |
|---|---|---|---|---|
| Card | 2.9% + $0.30 | Instant | No — chargebacks possible | Default, always shown first |
| ACH bank transfer | 0.8%, capped at $5 | Up to 4 business days | No — bank can return it | The discount rail |
| Instant Bank Payments (via Link) | 2.6% + $0.30 | Instant, but doesn't settle for 2 days | Yes — Stripe absorbs the risk | Held in reserve, not launched |

**We only launch with card + ACH.** The 4-day ACH confirmation window is not
a real cost to us: it sits entirely inside the delivery-gated payout hold we
already have in place (a seller isn't paid out until well after delivery
anyway, per §6), so slow ACH confirmation costs us nothing in practice — most
businesses don't get this for free, we do because of how payout timing
already works.

Instant Bank Payments is *not* a cheap rail — despite the name, it costs
almost as much as a card (2.6% vs. 2.9%). It's a risk-transfer product, not a
cost-saving one: Stripe eats the risk of the bank payment being reversed. It
stays in reserve as a fallback if ACH returns ever become a real problem
(see the 0.5% trigger below), not something we build for cost reasons.

**Bank-account linking must be one-time and reusable.** If a returning buyer
has to re-link their bank account on every purchase, ACH adoption won't
happen at any meaningful rate and this entire discount mechanic becomes
theoretical. The second purchase has to be one tap, same as a saved card.

---

## 6. What happens to the money after a sale

**We are not an escrow service, and that word is deliberately banned from
our own code, docs, and user-facing copy** — Stripe itself makes the same
point about its own tooling: "*Escrow* has a precise legal definition, and
Stripe doesn't provide escrow services or support escrow accounts" (Stripe's
[manual payouts docs](https://docs.stripe.com/connect/manual-payouts)).
What we actually do is a **transaction-tied hold with an objective release
trigger**, built on ordinary Stripe primitives, and that's the vocabulary to
use everywhere this gets described publicly — "claim window," "hold,"
"released" — never "escrow."

**Correction from an earlier version of this document: the charge type is
Stripe Connect *separate charges and transfers*, not direct charges.** An
earlier draft of this file (and `CLAUDE.md`) described direct charges — money
landing straight in the seller's own Stripe balance the instant a charge
succeeds, with the platform only controlling payout *timing* via manual
payout scheduling. **That is not what the shipped code does.** The real flow,
verified directly against `apps/api/internal/payment/payment.go` and
`internal/order/release.go`:

1. A buyer's charge (`PaymentIntent`, manual capture on the card rail, direct
   capture on ACH) is created and captured on **the platform's own Stripe
   account** — never the seller's.
2. The money sits in the **platform's** Stripe balance for the entire order
   lifecycle below — through shipping, delivery, and the claim window.
3. Only when an order reaches the `released` state does the platform fire a
   real Stripe **Transfer**, moving money out of its own balance into the
   seller's *connected account* balance (`order.ReleaseFunds`).
4. Only later, when the seller actively clicks "Withdraw," does a separate
   **Payout** move money from their connected balance to their bank account
   (`internal/payout`) — manual payout scheduling still applies at this hop,
   same reasoning as before: it's what stops a payout firing on its own.

The practical effect of this correction: **a refund never has to be clawed
back from a seller who already got paid**, because under this model the
seller was never paid until the hold cleared in the first place. A full or
partial refund during the claim window (§9 below) simply refunds the
platform's own charge — there's nothing on the seller's side to reverse. This
is strictly more protective than a true direct-charge design would have been,
and it's the actual mechanism that makes the buyer guarantee in
`docs/BuyerSellerGuarantee.md` possible at all.

**Why Stripe Connect Express is still the right account type** — but for a
different reason than an earlier draft of this file gave (which argued Express
vs. Standard based on `application_fee_amount`/fee-line display, a
direct-charge-only concept that doesn't apply here): a connected account under
separate charges and transfers only ever *receives* a Transfer from the
platform's balance and pays that out to its own bank — it never charges a
buyer's card itself. Stripe's onboarding is asked for the **`transfers`
capability only**, not `card_payments`, which is materially lighter-weight KYC
for the seller (no business statement descriptor, no "as an independent
merchant" framing) than a direct-charge integration would require
(`internal/seller/connect.go`'s `CreateExpressAccount` doc comment). Every
connected account's payout schedule is still set to `manual` at creation —
that's the lever that stops a seller's *own* Stripe balance from auto-draining
to their bank the moment a Transfer lands, same purpose as before, just one
hop later in the flow than an earlier draft of this file described.

### 6.1 The order lifecycle that actually enforces the hold

Every paid order is one row moving through an explicit 11-state machine
(`internal/order`, `orders.state`) — a support agent, a refund, and a fraud
reviewer all read the same field:

```
created → payment_pending → paid → awaiting_ship → shipped → delivered
                                                        ↓
                                                  claim_window
                                                   ↓         ↓
                                              released    claim_open
                                          (window elapsed,   ↓      ↓
                                           no claim filed) released refunded
```

Real, currently-enforced timers (`cmd/worker/order_timers.go`, polled every
minute):

| Trigger | Window | Effect |
|---|---|---|
| Seller never uploads tracking | **72 hours** after entering `awaiting_ship` | Auto-cancel, full refund |
| No delivery scan ever arrives | **21 days** after `shipped` | Auto-refund (protects the buyer from a dead tracking number) |
| Claim window | **3 days** post-delivery (orders under $250) / **7 days** (orders $250+) | Auto-release to seller if no claim is filed |

**Only Hous Trust gets an instant-release shortcut — Platinum and Gold do
not.** An earlier version of the code gave both Gold and Hous Trust sellers
a skip-the-claim-window release the instant a carrier scan confirmed
delivery; that was deliberately scaled back to Hous Trust only. Every other
tier, Platinum and Gold included, goes through the identical 3/7-day
claim-window trigger above. Tier promotion/demotion is real and running
(§4), so Platinum/Gold/etc. are all reachable through ordinary volume — but
Hous Trust specifically requires the application process in §4.6, so this
instant-release benefit is only ever felt by a seller an admin has actually
approved for Hous Trust, not something volume alone unlocks.

**Filing a claim inside the window stops the release timer automatically** —
opening a claim (`internal/dispute.OpenClaim`) transitions the order from
`claim_window` straight to `claim_open` in the same database write. The
worker's auto-release query only ever touches orders still sitting in
`claim_window`, so a claim filed before the deadline hits always wins that
race (both paths are the same compare-and-swap pattern `internal/order.Transition`
uses everywhere — whichever write lands first is the one that counts, the
other cleanly no-ops). Nothing further had to be built to make "a claim stops
the clock" true; it falls out of the state machine's shape.

### 6.2 A real Stripe chargeback is tracked separately from a claim, and now blocks payout

A cardholder can always go straight to their bank/card issuer instead of
opening a claim in our own UI — a genuine Stripe **dispute**
(`charge.dispute.*`), not a `claims` row. Because every charge lives on the
platform's own Stripe account (§6 above), a real chargeback debits the
**platform's** balance directly, never the seller's, no matter what state the
order is in when it happens.

This is now handled, not just documented as a gap:

- `internal/webhook` listens for `charge.dispute.created` /
  `charge.dispute.updated` / `charge.dispute.closed` and records every one in
  its own `chargebacks` table (`internal/chargeback`, migration `0034`) —
  deliberately a separate table from `claims`, since a chargeback can land on
  an order that never had a claim filed at all, at any point in that order's
  life, including well after it's released.
- The moment a dispute is created, a real email fires unconditionally (no
  "clear cases only" filter the way claims have) — every chargeback needs a
  human's eyes, since responding lives in the Stripe Dashboard, not this app.
- **Every place that would otherwise Transfer money to a seller now checks
  for a pending-or-lost chargeback on that order first** (both the
  claim-window-elapsed auto-release in `cmd/worker` and every dispute
  resolution path that pays the seller in `internal/dispute`) — if one
  exists, the Transfer is skipped and logged rather than paying a seller out
  on a charge Stripe has already reversed or is still deciding on.
- **What this does not yet do**: automatically respond to a dispute with
  evidence, or move an already-`released` order back to `refunded` when a
  chargeback resolves against the platform after the fact. A chargeback that
  arrives after Transfer has already happened is a real, unrecovered platform
  loss today, reconciled by a human reading the notification email and the
  Stripe Dashboard directly — there is no in-app admin surface for
  chargebacks yet, unlike claims' `/admin/claims`.

- **Default seller payout: weekly batched, seller-initiated.** Stripe charges
  a per-payout fee (0.25% + $0.25). Batching brings that fixed cost down
  meaningfully per order. There is no automatic sweep — a seller clicks
  "Withdraw" (Standard or Instant) themselves; an earlier automatic weekly
  sweep was built and then deliberately removed (`internal/payout/payout.go`'s
  own doc comment) because it defeated the point of the paid Instant upsell
  below — if funds got swept out automatically the moment they were
  released, a seller never had a real choice to pay for speed.
- **Instant payout is a paid upsell**, not a default: Stripe charges us 1.5%
  for it, we charge the seller 2% — a real revenue line, and a pressure
  valve for a seller who's frustrated by the normal hold.
- **Sellers can see money coming before it's withdrawable.** The Withdraw
  page shows a real available-to-withdraw balance plus a separate, greyed-out
  pending figure — every order a seller has sold that's genuinely paid for
  but hasn't reached `released` yet (not shipped, in transit, or still inside
  the claim window), combined across every in-flight sale. This is already
  real, live data (`internal/payout.GetSummary`), not a mockup — it slowly
  drains into the available balance as each order individually clears its
  hold.

---

## 7. What Stripe Connect actually costs us

Why Express specifically, and exactly what capability it's granted, is now
covered in §6 above (transfers-only, lighter KYC, no `application_fee_amount`
involved under separate charges and transfers). This section is just the cost
model, unchanged by that correction — the seller's net proceeds are computed
the same way regardless of charge type (§2), it's only *when* and *how* the
platform moves money toward the seller that changed.

**What Connect actually costs**, modeled against a synthetic ~$3.7M/year
order book (numbers below are relative-ranking-robust, not a real forecast —
see the caveat at the bottom):

| Component | Cost |
|---|---|
| Active seller (any month with at least one payout) | $2.00/month, flat |
| Per payout | 0.25% of the payout amount + $0.25 |

**The finding that actually matters for the business, not just engineering:**
roughly two-thirds of our total Connect cost is the flat $2/seller/month fee
— it barely moves with transaction volume. That means **seller count is
itself a cost to manage, not a vanity growth metric.** Four hundred serious,
high-volume sellers beat fourteen hundred casual ones at the *same* total
sales volume, because the casual ones each still cost $2/month whether they
sell $10 or $10,000. This should shape how the business thinks about growth:
court card shops and high-volume individual sellers, don't just chase signup
counts. (This is a product/growth conclusion, not an engineering one — noted
here because it falls directly out of the fee model.)

---

## 8. Sales tax: we collect it, we never touch it as revenue

Under marketplace-facilitator laws, we're almost certainly the party legally
responsible for collecting and remitting sales tax. **Under separate charges
and transfers (§6), this is actually simpler than the direct-charge model an
earlier draft of this section described**: the entire charge — goods, shipping,
tax, all of it — lands on the *platform's own* Stripe balance first, and stays
there until an order releases. There's no `application_fee_amount` sweep-back
step to get right, because the tax dollars were never in the seller's balance
in the first place to sweep back out. What we transfer to the seller at
release time (`internal/order.ReleaseFunds`) is exactly `seller_net_cents`
(minus any refund already issued) — tax and platform fee both simply stay
behind in the platform's balance by construction, not by a separate
reconciliation step.

We use Stripe Tax to calculate the actual rate for the buyer's address —
**we do not hand-roll our own sales tax rate tables.** State/local tax rules
change too often and the liability for getting it wrong is real.

**The one absolute rule in this whole document: the tax we charge a buyer
must equal, to the cent, what Stripe Tax calculated — never padded, rounded
up, or used as a buffer for any reason.** Charging money labeled "tax" that
doesn't match what gets remitted isn't a rounding quirk, it's the kind of
thing consumer-protection statutes and state tax authorities specifically
prohibit. Every payment path checks this exactly before letting a transaction
complete, and fails the transaction rather than silently proceeding if it
doesn't match.

---

## 9. What we cover when something goes wrong, and what we don't

We deliberately do **not** offer eBay-style unconditional buyer protection —
at our margins, that can't be funded. Instead, coverage limits are stated
plainly at checkout, and the honesty about the limits is itself part of the
transparency pitch, not something to soften.

| What happened | Who's financially responsible | Automated today? |
|---|---|---|
| Item wasn't as described | Seller | No — always routed to human review; no automated photo-comparison exists |
| Buyer says "never arrived," no tracking exists | Seller | **Yes** — `internal/dispute.autoAdjudicate` refunds the buyer automatically |
| Buyer says "never arrived," but tracking shows delivered, order under $50 | Platform (we absorb it — not worth disputing a small claim) | **Yes** — automatic |
| Same, but order is $50 or more | Buyer, with a fraud review first | No — human review |
| Payment fraud / stolen card used | Platform | No — human review |
| Buyer just changed their mind | Buyer — not covered at all | No — currently falls through to human review rather than an instant deny; see the open item in `docs/BuyerSellerGuarantee.md` §6.3 |
| Item damaged in transit, seller has adequate packing evidence | Platform, up to $100 | No — a human decides the amount; the $100 cap isn't system-enforced yet |

**Only 2 of these 7 rows resolve without a person.** That's a fine place to be
today — a claim that needs a human still gets one fast (a real `support@`
email fires the moment a claim auto-escalates into `human_review`, see
`docs/BuyerSellerGuarantee.md` §2) — but it's worth being precise, in any
public-facing copy, about which outcomes are instant and which mean "you'll
hear back after review."

**Budget assumption:** a baseline 0.4% dispute rate, multiplied by each
tier's modeled risk factor from §4.1 (so New-tier sellers are budgeted at
3.0× that baseline, Platinum at 0.5× — Hous Trust isn't sized this way at
all, see §4.6). Stripe charges us a flat $15 per
dispute regardless of who wins it, which is itself a real cost line. This
modeling assumption is unaffected by the direct-charge → separate-charges-and-
transfers correction above — it's about dispute *frequency and cost*, not
which Stripe balance the money moves through.

**The negative-balance exposure this section used to describe was written for
the wrong charge type, and needs restating.** A direct charge puts a dispute
on the *seller's* balance, which can go negative if they'd already been paid
out — that's a real, well-known Connect risk, but it isn't the risk this
platform actually carries, because every charge lives on the *platform's own*
Stripe account (§6). The real exposure today is simpler and sharper: **any
real chargeback debits the platform's own balance directly, full stop,
whether or not the corresponding order has already released funds to a
seller.** If it hasn't released yet, `internal/chargeback`'s payout-blocking
guard (§6.2) at least stops the platform from also paying the seller out on
top of losing the chargeback. If it has already released, the loss is
unrecoverable through this codebase today — there's no seller clawback
mechanism, by design (§6's whole point is that the seller was never on the
hook to begin with). This still needs the same actual-Stripe-Connect-
agreement legal review named in §10 below — the charge-type correction
changes *whose balance* takes the hit, not whether legal review is required
before real money moves.

**Most condition disputes are worth a few dollars, not a full return.** We
build a first-class "keep it, take X% back" partial-refund tool either side
can propose and the other can accept in one click — a full return on a
low-value card destroys the economics for everyone involved, so this is
expected to close the large majority of disputes without ever reaching a
human reviewer. See `docs/BuyerSellerGuarantee.md` §5 and `docs/SaleFlowPlan.md`
for the specific "70/30 split" quick-resolve version of this tool being built
on top of it.

---

## 10. Financial decisions still open — not yet made

These are named explicitly so nobody assumes a default was chosen quietly:

1. **Launch-period tier override (§4.7).** Does every new seller start at
   New/7%, or do we run a temporary better rate to compete harder for
   sellers early on? Not decided — revisit before the tier system goes live
   for real sellers.
2. **Agent-of-payee language in the seller agreement.** Needed even for the
   simplest single-seller-cart version of this model — this is legal
   drafting, not an engineering task, but it blocks flipping from
   test-mode to real money.
3. **Stripe Connect agreement review.** The hold-period and dispute-liability
   assumptions in §9 above are our own modeling of how Stripe's Connect
   agreement works — they need to be checked against the actual contract
   terms by counsel before this handles real money. Stripe can end this
   relationship faster than any regulator could.
4. **Multi-seller cart consolidation** (buying from two sellers in one
   checkout) is explicitly out of scope for now — routing one buyer's money
   to two sellers in a single transaction may itself trigger the same
   money-transmitter licensing question that shut down the original wallet
   design, depending on specific legal exemptions that vary by state. Needs
   a fintech attorney before it's built, not just an engineering decision.
5. **Should a bad review average actively demote a seller (§4.4), not just
   block their next promotion?** Currently only dispute rate triggers
   demotion. Not decided — worth revisiting once real review data exists to
   see whether rating decay in isolation (no matching rise in disputes) is
   something that actually happens, or a hypothetical not worth building for.

---

## 11. What changed from the original ("v1") model, and why

The original design (`docs/design-doc.md`) was built around a **pre-funded
platform wallet**: buyers deposited money into a wallet we held, purchases
moved funds through a platform-controlled escrow, sellers cashed out from
their wallet balance. That wallet was removed from this codebase before any
of it shipped, because holding customer funds in a platform balance *and* in
escrow — outside of a single, immediate transaction — is exactly the shape
of business that triggers money-transmitter licensing requirements in
roughly 49 states.

This model is the resolution to that problem, not a variation on it — but the
resolution isn't "money never touches the platform at all." It's **Stripe
Connect separate charges and transfers**, where the platform briefly *is* the
one holding the charge (§6), but only ever inside a single, transaction-tied,
objectively-bounded hold (claim window post-delivery) with exactly two
possible outcomes — released to the seller, or refunded to the buyer — never
a general-purpose balance a user can deposit into or withdraw from on demand.
That distinction (transaction-tied hold vs. general-purpose wallet) is the
actual legal argument `docs/Legal_MoneyTransitter.md` lays out for why this
design is a fundamentally different risk profile than the wallet that was
pulled, not "the platform never touches the money" — it does, briefly, by
design, and that's fine as long as the hold stays bounded and transaction-
specific. That's also why v1's flat 2% seller commission and 3-tier system
are replaced here by a 5-tier, 5.5–7% ladder: the numbers changed because the
whole payment architecture underneath them changed, not as an independent
pricing decision.

**Every dollar figure in this document that comes from "modeling" (the §7
Connect cost table, the §4.1 dispute-multiplier numbers) is derived from a
synthetic, generated order book — not real transaction data.** The *relative*
conclusions (Express costs more but is worth it; seller count is a real
cost lever; new sellers should pay more) are considered robust. The specific
dollar amounts are not a forecast and should be replaced with real numbers
as soon as this platform has actual order history to model against.

**Second correction, made in this pass:** an earlier version of this document
(and of `CLAUDE.md`) described the charge type itself as *direct charges* —
money landing straight in the seller's own Stripe balance, with the platform
only controlling payout timing. That was never what the shipped code
implements; §6 above has the corrected, code-verified description
(separate charges and transfers), and this section's "seller is legally the
merchant of record" line has been corrected to match. See
`docs/Legal_MoneyTransitter.md` for the underlying legal reasoning this
distinction is actually about, and `docs/BuyerSellerGuarantee.md` for the
buyer/seller-facing coverage policy built on top of the corrected
architecture.
