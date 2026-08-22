# Shipping Research — Labels, Tracking, Cost, and Packaging

**Status:** research only — no shipping code exists in the repo yet. This document is
what `internal/shipping` (CLAUDE.md §2, §6.11) should be built from once shipping work
starts. Scope: domestic US only, individual sellers shipping 1–10 raw cards or a single
graded slab, matching the design doc's two-tier PWE (untracked) / tracked model.

**Dating:** all pricing below is dated **August 2026**. Carrier rates change on a
predictable annual/semi-annual cadence — re-verify before finalizing any cost model in
code, and prefer a live rate-shopping API call over a hardcoded number wherever
possible. Figures not directly sourced are explicitly flagged as estimates.

---

## 1. Generating shipping labels — Shippo vs. EasyPost

### Account setup / negotiated rates

Neither platform requires AuctionHous-TCG to negotiate its own USPS or UPS commercial
contract. Both provide default carrier accounts with pre-negotiated discounted
commercial rates out of the box — sign up, get an API key, start buying labels at
commercial (not retail-counter) rates immediately.

- **EasyPost**: "Wallet Carrier Accounts" are available immediately on signup from the
  dashboard, no separate carrier setup. Adding UPS alongside an existing USPS
  integration requires no new auth, endpoints, or error handling — one unified
  shipment/rate/label object model across carriers.
  ([EasyPost USPS guide](https://docs.easypost.com/carriers/usps-ship-guide),
  [UPS guide](https://docs.easypost.com/carriers/ups-guide))
- **Shippo**: same shape — the Starter tier gives default discounted carrier rates with
  no separate USPS/UPS account needed. A per-label fee only applies if you connect your
  own carrier account (BYOCA) instead of using Shippo's provided rates.
  ([Shippo plan overview](https://support.goshippo.com/hc/en-us/articles/360003855652-Shippo-Subscription-Plan-Overview))

A negotiated-rate "Enterprise" upgrade exists on both for later, once volume justifies
it — not required for v1.

### Pricing model

| | EasyPost | Shippo |
|---|---|---|
| Free tier | Free for first 3,000 labels/month (Wallet Carriers), then $0.08/label | Starter: $0/mo, $0.05/label only if using your own carrier account (BYOCA) — $0 per-label fee on Shippo's own discounted rates |
| Paid tier | BYOCA: $20/mo + $0.08/label (not needed here) | Pro: $17–199/mo across 6 volume tiers; overage $0.08/label past 10,000/mo |
| Other | Insurance API: 1% of declared value, $1 min — relevant for slab insurance later. A separate Tracking API ($0.01–0.03/shipment) appears to target trackers *not* purchased as a label through EasyPost; tracking on a label bought through EasyPost is bundled — confirm at contract time. | Reported in-app (5¢) vs. API (7¢) label pricing conflicted across sources — confirm directly against Shippo's current docs before committing. |

Sources: [EasyPost pricing](https://www.easypost.com/pricing/),
[EasyPost Wallet/BYOCA plans](https://support.easypost.com/hc/en-us/articles/39984592062605-EasyPost-Wallet-and-Bring-Your-Own-Carrier-Account-Plans),
[Shippo pricing guide](https://onlineshippingcalculator.com/guides/shippo-pricing-plans-fees-guide),
[EasyPost vs Shippo comparison](https://www.aftership.com/blog/easypost-vs-shippo)

**Bottom line**: at expected v1 volume, both are effectively free at the platform
level for label generation itself — the real cost is carrier postage passthrough
(§3), not aggregator fees.

### End-to-end flow (same shape on both)

1. Create a **Shipment** (from/to address, parcel dimensions/weight).
2. Aggregator returns **rate quotes** across carriers/services in one response.
3. **Buy** the chosen rate → returns a label (PDF/PNG/ZPL) + tracking number.
4. A **Tracker** is registered automatically; carrier scan events flow back via webhook.

### Test mode

- **EasyPost**: dedicated Test API key. Test-mode labels are non-shippable placeholders
  and **do not reflect real negotiated pricing** — cost modeling should happen against
  production rates. ([Test environment docs](https://support.easypost.com/hc/en-us/articles/360044353331-Test-Environment))
- **Shippo**: no dedicated sandbox — use a second free account or the Test Token on
  your normal account. ([Sandbox testing](https://docs.goshippo.com/partner-integration/sandbox-testing))

### Void/refund unused labels

Matters for the "seller printed a mislabeled shipment" case:

- **Shippo**: `POST /refunds/` with the Transaction ID. Must be requested within 90
  days; rejected if scanned/used. USPS labels auto-refund after 30 days if unused.
  ([Refunding labels](https://docs.goshippo.com/docs/Billing_and_Invoices/RefundingLabels))
- **EasyPost**: Shipment Refund API, same shape. USPS labels refundable within 30 days
  (processing ~15+ days); UPS/FedEx within 90 days.
  ([Shipping refund docs](https://docs.easypost.com/docs/shipments/shipping-refund))

Neither is instant — design any "void a label" UI around a pending-refund state, not
an immediate confirmation.

### QR code / no-printer labels — important for this seller base

- **USPS Label Broker**: buy postage, request Label Broker instead of a PDF, get a
  short ID + QR code by email/SMS. Seller brings the packaged item + phone to any Post
  Office; staff or a kiosk prints the label free. Domestic-only, Ground Advantage +
  Priority Mail. ([EasyPost Label Broker](https://support.easypost.com/hc/en-us/articles/4404533889677-USPS-Label-Broker))
- **UPS QR/mobile barcode**: "Email QR Code" at label creation, bring phone to any UPS
  Store or Access Point (5,000+ / 40,000+ locations), scanned and printed in minutes,
  free. QR valid 14 days, reprintable.
  ([UPS QR guide](https://atoship.com/blog/ups-qr-code-no-printer-shipping))
- **EasyPost API**: explicit, dedicated support — a follow-up call to
  `/shipments/{id}/forms` generates the QR and returns it. Has a standalone technical
  guide. ([Label Broker technical guide](https://support.easypost.com/hc/en-us/articles/4410441700493-USPS-Label-Broker-Technical-Guide))
- **Shippo API**: also supported via `extra.qr_code_requested: true` on the shipment
  request. ([QR code docs](https://docs.goshippo.com/docs/Shipments/QRCode))

Both support this well; EasyPost's documentation is more explicit and dedicated to it.

### Recommendation: EasyPost

1. Generous free tier (3,000 labels/month, $0 fee, no card required) matches
   pre-revenue-scale volume for a long runway.
2. Best-documented QR/Label-Broker flow — a first-class requirement for this seller
   base, not an edge case.
3. Single unified carrier abstraction (add UPS with no new auth/endpoints) reduces
   integration surface in `internal/shipping`.
4. Developer-first REST API and clearly documented webhook retry/failure semantics
   (§2) fit a Go backend well.
5. Built-in Insurance API (1% of value, $1 min) is a clean upsell path for graded
   slabs later, without a second vendor.

Shippo remains a credible fallback (its $0-per-label-at-low-volume model may edge out
EasyPost's $0.08/label overage at much higher volume, e.g. >3,000 labels/month) — worth
revisiting if the platform reaches that scale.

---

## 2. Tracking — webhooks, reliability, and the escrow-release risk

### Webhook mechanics

- **EasyPost**: `tracker.updated` events. Must respond 2xx within 30 seconds; after 6
  consecutive failures EasyPost stops retrying that endpoint. `internal/shipping`'s
  webhook handler needs to ack fast and process asynchronously.
  ([Webhooks guide](https://docs.easypost.com/guides/webhooks-guide))
- **Shippo**: `track_updated` events with the full Tracking object. **Documented
  gotcha**: a `"Delivered"` event can arrive before the `"Out For Delivery"` event for
  the same shipment — events aren't guaranteed chronological. Any consumer needs to be
  idempotent and order-tolerant. ([Webhooks docs](https://docs.goshippo.com/docs/tracking/webhooks))

Typical event set on both: label created → accepted/pre-transit → in transit → out for
delivery → delivered, plus exception/return-to-sender/failure branches. Precise
scan-to-webhook latency isn't published by either vendor — confirm empirically during
integration testing.

### USPS scan reliability vs. UPS — confirmed real risk

- Industry estimates put USPS tracking accuracy around 92–95%, but a cited 2023 USPS
  Inspector General audit found 64% of sampled shipments had some tracking inaccuracy.
  Root causes: missed scans at sorting facilities, skipped non-essential scans during
  high volume, and systems showing anticipated rather than confirmed movement. USPS
  does not scan at every facility — 24–48 hour tracking gaps are considered normal.
  ([USPS tracking accuracy analysis](https://www.historytools.org/consumer/is-usps-tracking-accurate))
- Anecdotal industry commentary notes local post offices sometimes ship without an
  initial scan at all, taking days for the first scan to appear — "not seen nearly as
  often for UPS packages." Treat "UPS more reliable than USPS" as well-supported
  directional consensus, not a hard sourced number.

**This confirms the design doc's existing PWE/tracked split is the right shape** — a
missing or late "delivered" scan is a realistic failure mode for USPS specifically,
which is the carrier most PWE and light tracked shipments will use.

### Is a "delivered" webhook alone safe to trigger fund release? No.

Real-world precedent for hardening the tracked-release path:

- **eBay** requires signature confirmation for orders ≥ $750 to retain seller
  protection — an objective, carrier-verified evidence bar rather than a scan alone.
  ([eBay signature confirmation policy](https://www.ebay.com/help/policies/member-behavior-policies/signature-confirmationpolicy?id=5154))
- **StockX** releases seller payouts only after carrier-confirmed delivery (not
  seller self-report), plus 1–3 business days additional processing.
  ([StockX payout docs](https://stockx.com/help/articles/as-a-seller-how-and-when-do-i-get-paid))
- **Mercari** gives buyers a 72-hour review window after delivery before releasing
  funds, functioning as both a grace period and a dispute-window buffer.
  ([Mercari seller protection](https://www.mercari.com/us/help_center/topics/account/policies/seller-protection/))

**Recommended safeguards for `internal/escrow`'s tracked-item release trigger:**

1. Keep the design doc's 24h-post-delivery-scan timer as the primary trigger, but
   treat the incoming "delivered" webhook as advisory input to the escrow state
   machine, not a direct balance mutation — per CLAUDE.md §5.2.
2. Require signature confirmation above a dollar threshold (design doc open question
   #1) — mirror eBay's $750 line, or lower given a lower average order value here —
   specifically for graded slabs and high-value raw cards.
3. Add a fallback path for missing scans: if a tracked shipment shows no delivery scan
   after an outer bound (e.g. 10–14 days of tracking silence, or an explicit
   exception/return-to-sender event), route to manual admin review rather than
   auto-releasing or leaving escrow stuck indefinitely. No out-of-the-box webhook
   behavior covers this gap — it needs deliberate design.
4. Never let an "Out for Delivery" event arriving after "Delivered" regress the state
   machine — delivered should be a monotonic terminal state per shipment once reached.

---

## 3. Cost structure — what actually gets taken from each order

### USPS Ground Advantage (commercial/aggregator rates)

**Note a major July 2026 structural change**: as of July 12, 2026, USPS eliminated the
separate 4 oz / 8 oz / 12 oz sub-tiers for Ground Advantage Commercial pricing — every
package under 1 lb now bills at the old "12–15.99 oz" rate, regardless of actual
weight. This is a real, recent cost increase specifically for very light single-card
shipments, reported as up to a ~32% jump on the lightest packages, contributing to an
~11.8% average Commercial rate increase across 2026.
([Transimpact](https://transimpact.com/blog/usps-rate-to-increase-ground-advantage-commercial-rates-by-11.8),
[Ship.com July 2026 breakdown](https://www.ship.com/post/usps-rate-changes-july-2026))

Post-July-2026 flat sub-1lb Commercial rate by zone — **flagged as approximate**;
sources disagreed on zone-8 figures ($7.13 vs $8.40), so treat this as directional and
get a live rate quote from EasyPost/Shippo before finalizing any cost model:

| Zone | Approx. Commercial rate, sub-1lb (post-7/12/26) |
|---|---|
| 1 (local) | ~$6.16 |
| 4 (regional) | ~$6.39 |
| 5 (mid-country) | ~$6.52–6.90 |
| 8 (coast-to-coast) | ~$7.13–8.40 |

1 lb: ~$7.61–8.74 by zone; 2 lb: ~$7.99–9.95.
([idshipthat.app](https://idshipthat.app/shipping-rates/usps-ground-advantage/))

Retail counter rates run noticeably higher (~$9.55–$12.90 at 1 lb across zones) —
reinforces buying through an aggregator rather than sending sellers to a counter.

### USPS First-Class Mail (the actual PWE mechanism)

A card in a penny sleeve + top loader inside a plain envelope typically weighs well
under 1 oz to ~2 oz:

- 1 oz letter: $0.82 (stamp) / $0.78 (metered/API rate)
- Each additional oz: $0.29 → a 2 oz PWE runs **~$1.11**

([USPS postage rates 2026](https://www.mailpro.org/post/usps-postage-rates-2026/))

**Whatnot** — a directly comparable card marketplace — runs exactly this mechanism as
an explicit, named, seller-toggleable option ("USPS First-Class Mail Letter (FCML),
also known as plain white envelope (PWE)"), directly validating the design doc's PWE
assumption against real marketplace precedent.
([Whatnot FCML/PWE doc](https://help.whatnot.com/hc/en-us/articles/23014988889229-USPS-First-Class-Mail-Letter-FCML-shipping-for-sellers))

**Escrow-relevant caveat**: First-Class Mail Letter/PWE carries no included carrier
liability coverage — USPS's base $100 liability applies to Priority Mail, Priority
Mail Express, and Ground Advantage, explicitly **not** First-Class Package Service.
This reinforces treating PWE as the higher-risk, no-tracking tier with the longer
6-business-day release window.

### UPS Ground — confirmed not competitive for this weight class

UPS Ground has no sub-1lb pricing band — the lightest tier starts at 1 lb:

- Commercial: ~$7.25 at 1 lb vs. retail $11.99–15.75
- USPS Ground Advantage at 1 lb: ~$7.61–8.74 — roughly comparable to UPS at exactly
  1 lb, but USPS wins clearly under 1 lb since UPS effectively rounds a 2–4 oz card
  shipment up to its 1 lb minimum.
- UPS Ground also applies dimensional weight billing (L×W×H ÷ 139), which can push a
  lightweight but boxed graded-slab shipment above its actual weight for billing.

([Ship.com UPS vs USPS comparison](https://www.ship.com/post/ups-ground-saver-vs-usps-ground-advantage))

**Recommendation**: default the tracked tier to **USPS Ground Advantage**, not UPS,
for essentially all listings in this weight/value class. Still worth rate-shopping
(both aggregators quote multi-carrier automatically) for heavier multi-card lots or
larger boxes, but shouldn't be the assumed default.

### Aggregator markup

Effectively $0 at v1 scale for either vendor (§1) — the real cost is carrier postage,
not aggregator fees.

### Rough total cost per shipment (synthesized estimate, not a single sourced figure)

| Tier | Postage | Packaging materials (approx.) | Total rough cost |
|---|---|---|---|
| PWE (1 card, untracked) | ~$0.82–1.11 | ~$0.10–0.30 | **~$1.00–1.40** |
| Tracked bubble mailer (1–10 cards) | ~$6.16–8.40 | ~$0.50–1.50 | **~$6.70–9.90** |
| Tracked box (graded slab) | ~$6.16–9.95 | ~$1–3 | **~$7–13** |

Against the platform's ~2% take rate: on a low-dollar single-card sale ($15–25), a
~$7–10 tracked-shipping cost dwarfs the platform's own margin — this is exactly why
the PWE tier matters commercially, not just as UX: it's the only way sub-$20 raw
singles stay viable to sell without shipping eating most or all of the sale price.
This is precisely the tension the design doc's "cart batching for sub-$20 singles"
(§8, still to build) exists to solve — batching amortizes the ~$7 tracked-postage
floor across several items instead of paying it once per single-card sale.

---

## 4. Safe physical packaging of cards

### Raw single card / small stack — industry-consensus standard

A consistently repeated three-layer pattern across sourced guides:

1. **Penny sleeve** — surface/scratch protection.
2. **Top loader (or card saver)**, correctly sized — rigid edge/corner support; never
   put a bare unsleeved card directly in a top loader.
3. **Team bag** around the sleeved-and-top-loaded card — keeps the top loader from
   sliding out, adds a moisture barrier.
4. **Painter's tape (not clear packing tape) to seal**, applied to the team bag, not
   the top loader directly — clear tape on a top loader is a repeatedly-flagged mistake.
5. **Cardboard stays** on both sides, cut slightly larger than the card holder, to
   prevent flexing.
6. **Snug-fitting bubble mailer** — explicitly not oversized; a loose holder rattling
   inside a mailer concentrates impact on one corner instead of distributing it.

([valuemailers.com](https://www.valuemailers.com/how-to-ship-trading-cards-safely/),
[TCG Protectors guide](https://tcgprotectors.com/blogs/trading-card-game-blogs/how-to-ship-trading-cards-guide))

### "Do Not Bend" labels — largely ineffective, confirmed

USPS officially removed "Do Not Bend" as a recognized handling instruction from its
Domestic Mail Manual back in 2007. ~95% of First-Class Mail is processed by automated
sorting machinery reading barcodes only — it has no mechanism to respect a surface
label. There's no system-level enforcement and no compensation if the item arrives
bent anyway. Physical rigidity (cardboard stays, a genuinely rigid mailer) is the only
thing that reliably works.
([Analysis](https://onlineshippingcalculator.com/guides/can-i-write-do-not-bend-on-an-envelope))

**Implication**: if seller-facing packaging guidance mentions "Do Not Bend," frame it
as low-value/optional. Dispute-evidence standards should weight visible cardboard
stiffeners in photos far more than surface labeling.

### Graded slabs

- Standard: bubble wrap (2+ layers) → team bag (moisture barrier) → rigid cardboard
  sandwich on both flat faces, secured with rubber bands or tape → placed inside a
  snug bubble mailer or, better for higher-value slabs, a purpose-built rigid slab
  mailer/box.
- **Container choice should scale with value**: sturdy box packaging is recommended
  for slabs over roughly $100; a snug bubble mailer alone is called out as inadequate
  for anything of real value.
  ([ballcardgenius.com](https://ballcardgenius.com/blog/how-to-ship-graded-cards-safely-securely/))
- **Corner-crack mechanism**: a slab that can tumble loose inside its mailer
  concentrates all impact energy on a single corner — the literal failure mode.
  Custom-fit rigid slab mailers meaningfully reduce this versus generic padding.
- **Carrier liability is limited and conditional**: USPS's $100 base coverage applies
  to Priority Mail/Priority Mail Express/Ground Advantage (not First-Class Package
  Service); UPS/FedEx include $100 on standard services. Actually collecting requires
  proving the carrier caused the damage. Third-party shipping insurance (e.g.
  Shipsurance, attachable at label purchase via either aggregator) is generally faster
  and more reliable for claims than base carrier liability. USPS allows concealed-
  damage claims up to 15 calendar days post-delivery; later discovery isn't covered.
  ([Shipsurance terms](https://www.shipsurance.com/shiptection/terms))
- Liability for a cracked slab case in transit is genuinely disputed in hobby
  practice — exactly the ambiguity a documented platform packaging requirement plus
  mandatory pre-shipment photos would resolve upfront rather than litigate after the
  fact in the dispute flow.

### Precedent: other marketplaces document a packaging requirement

**Whatnot** has a formal published packaging-guidelines policy: "All cards must be
packaged to prevent bending, surface damage, or movement. When sealed, the package
should not allow much movement if gently shaken." It also runs a High-Value Loss
Reimbursement policy requiring, for high-value items specifically, **video (not
photo) footage showing the item being packed and the package sealed on camera**, plus
a clearly visible label with tracking number and buyer name.
([Whatnot packaging guidelines](https://help.whatnot.com/hc/en-us/articles/360061604591-Packaging-guidelines),
[Whatnot high-value policy](https://help.whatnot.com/hc/en-us/articles/5522583677837-High-Value-Loss-Reimbursement-Policy))

This is a strong, directly-relevant precedent: a written, value-tiered packaging
standard (photo evidence for standard items, video for high-value) mirrors the same
"objective evidence bar" shape the design doc already wants for the signature-
confirmation threshold (§6.5).

### Recommended minimum packaging standard

1. **Raw single/small stack**: penny sleeve → top loader/card saver → team bag
   (painter's tape seal on the bag, not the top loader) → cardboard stays →
   snug-fit mailer. PWE mailers don't need rigid backing beyond the top loader itself.
2. **Graded slab**: bubble wrap (2 layers) → team bag → rigid cardboard sandwich or
   purpose-built slab mailer → snug bubble mailer (sub-$100 slabs) or small box with
   void-fill (over ~$100 slabs) — never shipped loose in an oversized box.
3. **Require a pre-drop-off packaging photo** as part of the "mark as shipped" flow —
   cheap to implement, directly usable as dispute evidence, mirrors Whatnot's
   precedent. Reserve video evidence for above a value threshold (mirroring the
   signature-confirmation-threshold concept), not every shipment.

---

## 5. System design synthesis

*(How §1–4 shape `internal/shipping` — synthesis, not new research.)*

**Vendor**: **EasyPost**. Both USPS and UPS live behind one Shipment/Rate/
Transaction/Tracker object model — default rate-shopping to USPS Ground Advantage for
the tracked tier (§3 confirms UPS isn't competitive at this weight class) and USPS
First-Class Mail/PWE for the untracked tier.

**`internal/shipping` package responsibilities**:

- **Label purchase endpoint** (e.g. `POST /orders/{id}/shipping-label`): given an
  order + chosen service tier (PWE vs. tracked), calls EasyPost to create a Shipment,
  rate-shop, and buy the cheapest/appropriate rate (USPS-first). Returns a label
  URL/PDF, or, when the seller has no printer, requests the USPS Label Broker QR path
  and returns a QR image for in-app display.
- **Webhook ingestion endpoint** (e.g. `POST /webhooks/easypost`): receives
  `tracker.updated` events, must ack within EasyPost's ~30s/2xx requirement — enqueue
  for async processing rather than doing DB writes inline. Feed events into a genuine
  **tracking state machine** (`label_created → in_transit → out_for_delivery →
  delivered` plus `exception`/`return_to_sender`), per CLAUDE.md §5.2 — this also
  solves the documented out-of-order-webhook risk, since a state machine can simply
  refuse to regress a terminal `delivered` state.
- **The tracking state machine feeds `internal/escrow`'s release trigger, but is
  advisory, not authoritative**: `delivered` starts the design doc's 24h timer; PWE
  shipments run their existing 6-business-day "marked shipped" timer independent of
  any scan. Add a manual-review fallback for tracked shipments with no delivery scan
  after an outer bound (10–14 days of silence, or an exception event) — this gap isn't
  handled by any out-of-the-box webhook behavior.
- **Signature confirmation** should be a selectable/required rate option above an
  order-value threshold (design doc open question #1 — mirror eBay's $750 line or
  lower, given a lower average order value here).
- **Per-order data to store**: `carrier`, `service_tier` (PWE vs. tracked),
  `tracking_number`, `label_cost_cents` (`pkg/money.Cents`, per CLAUDE.md §5.1 — never
  `float64`), `label_purchased_at`, `easypost_shipment_id`/`tracker_id` (for
  refund/void calls and webhook correlation), `current_tracking_status`,
  `delivered_at` (nullable, set only by the state machine),
  `signature_confirmation_required` (bool), `packaging_photo_url` (Supabase Storage,
  matching the existing listing-photos pattern, §6.13).
- **Void/refund path**: a "void label" action wired to EasyPost's refund endpoint,
  surfacing the pending/multi-day refund status honestly rather than implying instant
  cancellation.

**Seller-facing UI requirements falling out of this**:

- "Mark as shipped" should show tier-appropriate packaging guidance (§4, split
  raw-card vs. slab) inline, and require a packaging photo upload before the
  label/QR flow completes.
- QR-code/no-printer should be a first-class UI option, not a fallback afterthought —
  display the QR/Label Broker code full-screen with "bring this and your package to
  any Post Office" framing.
- A dollar-value-gated video requirement (mirroring Whatnot) is worth reserving for a
  later pass, once the dispute flow exists to actually consume that evidence — don't
  over-build evidence collection ahead of the state machine that would use it.

---

## Recommended approach (short version)

Integrate **EasyPost** (free ≤3,000 labels/month, best-documented QR/no-printer flow,
unified USPS+UPS API, Go-friendly REST design). Default the tracked tier to **USPS
Ground Advantage** (UPS isn't cost-competitive under ~1 lb) and keep PWE on **USPS
First-Class Mail**, both bought at commercial/aggregator rates. Treat carrier
"delivered" webhooks as advisory input into an explicit tracking state machine, not a
direct escrow trigger — keep the design doc's existing 24h-tracked/6-day-PWE split,
add a signature-confirmation gate above a value threshold and a manual-review fallback
for scan-silent shipments, since USPS scan reliability is a real, documented risk to
an automated money-release trigger. Require a packaging photo at "mark as shipped" and
document a concrete minimum packaging standard (three-layer for raw cards,
rigid-sandwich-or-box for slabs) — both cheap to build now and directly useful as
dispute evidence later, with Whatnot as validated real-world precedent for exactly
this kind of policy in the same vertical.
