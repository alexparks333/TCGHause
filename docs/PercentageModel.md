# The Percentage Model — every financial decision, in one place

**Status:** describes the v2 payment/fee architecture (Stripe Connect direct
charges, no platform custody of funds). Supersedes the flat-2%/wallet-based
model in `docs/design-doc.md` ("v1") — see the note at the end of this file for
exactly what changed and why.

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
| Haus Trust | 5.50% | $6.08 | $98.92 |

---

## 4. Seller trust tiers — why the fee rate isn't flat

### 4.1 The ladder

| Tier | Rate | Reached at (cumulative completed orders) | Modeled dispute risk vs. average |
|---|---|---|---|
| New | 7.00% + $0.30 | 0–14 | 3.0× |
| Bronze | 6.50% + $0.30 | 15–49 | 2.0× |
| Silver | 6.25% + $0.30 | 50–149 | 1.2× |
| Gold | 6.00% + $0.30 | 150–499 | 0.8× |
| Haus Trust | 5.50% + $0.30 | 500+ | 0.5× |

**Gold, not New, is the number we lead with in marketing** ("6% + $0.30" is
the headline rate quoted against eBay's ~13.6%). 5.5% is something a seller
earns, not something advertised as typical.

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
sellers reach Bronze, about 31% reach Silver, and Haus Trust stays genuinely
aspirational (~2% of sellers) rather than a rate nobody actually pays.

### 4.2 You can't buy your way up with volume alone

Promotion requires **all** of the following, not just an order count:
- Dispute rate under 2% over the trailing 90 days
- No unresolved claim older than 7 days
- Account age of at least 14 days

**Deliberately not gated on review count** ("get 10 five-star reviews") —
review-count gates create pressure to solicit reviews, which is a known way
marketplace ratings get gamed and stop meaning anything. Dispute rate is
harder to fake and is the thing we actually care about.

### 4.3 New sellers get a floor under how long they can be stuck at the worst rate

A New-tier seller graduates to Bronze automatically at **25 completed orders
or 30 days, whichever comes first** — as long as the dispute/claim gates
above are clean. This caps the downside for someone taking a chance on a new
platform, and costs us almost nothing, since a brand-new seller is by
definition low-volume.

### 4.4 Tiers can go down, not just up

If a seller's trailing-90-day dispute rate exceeds **4%**, they drop one
tier and can't re-promote for 30 days. When this happens, the seller is told
the specific number that triggered it — never a vague "your standing has
changed."

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

### 4.6 The one thing we haven't decided yet

At launch, nearly all order volume will sit in the New tier (7% — our worst
rate) at exactly the moment we're competing hardest to attract sellers away
from eBay. Most marketplaces subsidize the early period and monetize later —
worth considering a temporary launch-period override (e.g., every new seller
starts at Silver for the first six months, treated explicitly as a deliberate
customer-acquisition cost rather than a permanent rate change). **This is an
open decision, not yet made** — see §7 below.

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
our own code, docs, and user-facing copy.** Every charge is a Stripe Connect
**direct charge** — the money goes straight into the *seller's own* Stripe
account the moment the charge succeeds. We never hold it. What we do control
is *when Stripe pays that money out of the seller's Stripe balance into their
bank account* — every connected account is set to manual payout scheduling,
and we decide when to trigger a payout, batched weekly by default. That's
payout-timing control on funds that are already the seller's, not custody.
This distinction is not just semantic: it's the entire reason this
architecture avoids the money-transmitter licensing exposure that shut down
this project's earlier wallet-based design (see the note at the bottom of
this file).

- **Default: weekly batched payouts.** Stripe charges a per-payout fee
  (0.25% + $0.25). Batching 20 orders into one weekly payout brings that
  fixed cost down to about a penny per order. A seller who wants faster
  money can opt into per-order payouts and pays the extra cost themselves.
- **Instant payout is a paid upsell**, not a default: Stripe charges us 1.5%
  for it, we charge the seller 2% — a real revenue line, and a pressure
  valve for a seller who's frustrated by the normal hold.
- **Gold and Haus Trust sellers skip the claim-window wait entirely** — their
  payout releases the moment the carrier scans the package as delivered,
  instead of waiting out the standard 3–7 day claim window. This is one of
  the concrete, felt benefits of reaching the top tiers, not just a lower
  percentage rate.

---

## 7. Why we're on Stripe Connect Express, and what it costs us

**Account type: Express**, meaning *we* set the fee percentage the seller
sees, and Stripe just moves money according to our rules. The alternative
(Standard accounts) is free to us but shows the seller two separate Stripe +
platform fee lines instead of one clean number — which breaks the "seller
net is identical either way" promise in §2 and undermines the whole
transparency pitch. We pay more for Express on purpose.

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
responsible for collecting and remitting sales tax — but because every charge
is a direct charge into the seller's account, the tax dollars land in the
*seller's* balance first, not ours. We sweep them back out immediately via
Stripe's `application_fee_amount` mechanism (our platform fee *plus* the tax
amount, taken as one combined application fee) — otherwise sellers would be
sitting on our tax liability in their own bank accounts, which is not
something to discover after the fact.

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

| What happened | Who's financially responsible |
|---|---|
| Item wasn't as described | Seller |
| Buyer says "never arrived," no tracking exists | Seller |
| Buyer says "never arrived," but tracking shows delivered, order under $50 | Platform (we absorb it — not worth disputing a small claim) |
| Same, but order is $50 or more | Buyer, with a fraud review first |
| Payment fraud / stolen card used | Platform |
| Buyer just changed their mind | Buyer — not covered at all |
| Item damaged in transit, seller has adequate packing evidence | Platform, up to $100 |

**Budget assumption:** a baseline 0.4% dispute rate, multiplied by each
tier's modeled risk factor from §4.1 (so New-tier sellers are budgeted at
3.0× that baseline, Haus Trust at 0.5×). Stripe charges us a flat $15 per
dispute regardless of who wins it, which is itself a real cost line.

**A real financial exposure worth naming plainly:** because these are direct
charges, a dispute first hits the *seller's* Stripe balance — but Stripe's
own Connect agreement makes *us*, the platform, liable if a connected
account's balance goes negative (e.g., a seller who already got paid out
before a dispute lands). The mitigations are: the payout hold keeps a
balance present on the account when disputes are most likely to land,
consequences escalate with a seller's dispute rate, and repeated disputes
demote a seller's tier (§4.4) — all of which reduce how often this exposure
actually gets triggered, but none of which eliminate it. This is exactly the
kind of thing that needs the actual Stripe Connect agreement terms reviewed
by counsel before we're moving real money (see §7 of the open questions
below) — the exposure described above is our modeling of it, not a confirmed
reading of Stripe's contract.

**Most condition disputes are worth a few dollars, not a full return.** We
build a first-class "keep it, take X% back" partial-refund tool either side
can propose and the other can accept in one click — a full return on a
low-value card destroys the economics for everyone involved, so this is
expected to close the large majority of disputes without ever reaching a
human reviewer.

---

## 10. Financial decisions still open — not yet made

These are named explicitly so nobody assumes a default was chosen quietly:

1. **Launch-period tier override (§4.6).** Does every new seller start at
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

This model is the resolution to that problem, not a variation on it: with
Stripe Connect direct charges, **the seller is legally the merchant of
record** and money never sits in a platform-controlled balance at any point
— it goes straight to the seller, and we only control *when* it gets paid
out of an account that was never ours. That's also why v1's flat 2%
seller commission and 3-tier system are replaced here by a 5-tier, 5.5–7%
ladder: the numbers changed because the whole payment architecture
underneath them changed, not as an independent pricing decision.

**Every dollar figure in this document that comes from "modeling" (the §7
Connect cost table, the §4.1 dispute-multiplier numbers) is derived from a
synthetic, generated order book — not real transaction data.** The *relative*
conclusions (Express costs more but is worth it; seller count is a real
cost lever; new sellers should pay more) are considered robust. The specific
dollar amounts are not a forecast and should be replaced with real numbers
as soon as this platform has actual order history to model against.
