# Money Transmission & the Escrow Question

**Status:** background research, not legal advice. Prepared to inform a conversation
with a real payments/fintech attorney before the destination-charges checkout rework
(see CLAUDE.md §5.1/§7) goes live with real money — not a substitute for that
conversation, and not a green light to launch on its own.

**Question researched:** does moving from a pre-funded stored-value wallet (the
feature pulled from this repo, CLAUDE.md §5.1/§7) to a Stripe Connect-native,
transaction-tied hold — buyer's card charged to the platform's own Stripe balance,
held only until delivery is confirmed and a claim window elapses, then transferred to
the seller — meaningfully change money-transmitter licensing (MTL) exposure, or is it
the same risk with better branding?

---

## Plain-language summary

There's a real, legally-recognized distinction between the wallet model that was
pulled and the Stripe-Connect-native model now being considered — but it's a
distinction of *degree and structure*, not a bright line, and it depends entirely on
implementation details not yet locked in. Federal law (FinCEN/BSA) and most state
money-transmission statutes exempt funds that are "integral to" completing an
already-agreed sale between identified parties, held only as long as reasonably
necessary, and never diverted to any other purpose — which is roughly what a
delivery-confirmation-triggered claim window is. A general-purpose stored-value
wallet (deposit anytime, spend/withdraw anytime, not tied to a specific transaction)
is the pattern regulators treat as the clearest case of money transmission, and it's
also the pattern at least one real marketplace (Mercari) chose to get fully licensed
for rather than argue an exemption. The core risk in the new design isn't the concept
of a "hold" — it's implementation choices like whether funds ever leave Stripe's own
licensed rails, whether the hold has an objective, transaction-tied end condition, and
whether wallet-like behavior gets accidentally rebuilt into it (e.g., a seller's payout
balance sitting and accumulating). This is exactly the kind of fact-specific
line-drawing that needs a payments lawyer to review the actual fund-flow diagram
before real money moves through it.

---

## 1. Federal framework — FinCEN / Bank Secrecy Act

The core definition lives at **31 CFR § 1010.100(ff)(5)**. Per the regulation text
(via [Cornell LII](https://www.law.cornell.edu/cfr/text/31/1010.100),
[eCFR](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100)):

> "Money transmitter" means "a person that provides money transmission services."
> **"Money transmission services"** means "the acceptance of currency, funds, or other
> value that substitutes for currency from one person and the transmission of
> currency, funds, or other value that substitutes for currency to another location or
> person by any means."

That's broad on its face — but §1010.100(ff)(5)(ii) carves out several exemptions. The
two that matter most here:

- **(ff)(5)(ii)(F) — the goods/services exemption**: a person is *not* a money
  transmitter if they "accept[] and transmit[] funds only integral to the sale of
  goods or the provision of services, other than money transmission services, by the
  person who is accepting and transmitting the funds."
- **(ff)(5)(ii)(B) — the payment processor exemption**: a person is not a money
  transmitter if they "act[] as a payment processor to facilitate the purchase of, or
  payment of a bill for, a good or service through a clearance and settlement system by
  agreement with the creditor or seller."

**FinCEN has actually ruled on an escrow fact pattern directly on point.** In
administrative ruling **FIN-2014-R004** (issued April 29, 2014), FinCEN reviewed a
company that received buyer funds and held them in escrow, releasing to the seller
only once specified conditions precedent were satisfied. FinCEN found this exempt,
reasoning (per
[Lexology's summary of the ruling](https://www.lexology.com/library/detail.aspx?g=3c38983d-4b1d-4aab-b15a-62f413c33677),
corroborated by the ruling title indexed at
[FinCEN.gov](https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-money-services-business-1)):

> "the company's money transmission activities...are only integral to its provision of
> transaction management services...not a separate and discrete service in addition to
> the underlying service, but instead...a necessary and integral part of the service
> itself."

The same batch of 2014 rulings reportedly went the other way for at least one other
business (a real-time payment/settlement platform, referenced in secondary reporting
as FIN-2014-R005) where FinCEN found the payment/transmission function was *not*
integral to any other underlying service — meaning it stood alone as a discrete
money-transmission service. **Gap:** the primary text of that second ruling wasn't
independently confirmed (FinCEN's PDF server timed out repeatedly during research) —
treat that half of the contrast as directionally right but unverified.

The through-line FinCEN itself has articulated: whether the exemption applies is "a
matter of facts and circumstances" — there's no formula, only a fact pattern
regulators (and later, courts) evaluate holistically.

---

## 2. State law patterns — the Money Transmission Modernization Act (MTMA)

The **Conference of State Bank Supervisors (CSBS)** finalized a model uniform law, the
MTMA, in August 2021 to harmonize the state patchwork
([CSBS MTMA overview](https://www.csbs.org/csbs-money-transmission-modernization-act-mtma)).
As of CSBS's own tracker, **31 states** have enacted the MTMA in full or in part,
representing roughly 99% of reported U.S. money-transmission activity
([CSBS legislative update](https://www.csbs.org/state-pending-enacted-mtma-legislation)).

**The agent-of-payee exemption** (MTMA §3.01(b), per commentary from
[regulatoryoversight.com](https://www.regulatoryoversight.com/2021/09/csbs-releases-money-transmission-model-law/)
and [faisalkhan.com](https://faisalkhan.com/solutions/licensing/money-transmitter-license/agent-of-payee-exemption))
requires **all three** of:

1. A written agreement between the payee (here, the seller) and the agent (the
   platform/processor), directing the agent to collect and process payments on the
   payee's behalf;
2. The payee holds the agent out to the public as authorized to accept payment on its
   behalf; and
3. Payment is treated as *received by the payee* the moment it's received by the
   agent — meaning the payor's (buyer's) obligation is legally extinguished at that
   point, and the buyer bears no risk of loss if the agent fails to remit to the
   payee.

That third prong is the trickiest one to satisfy cleanly in an escrow-with-a-dispute-
window design, because a buyer *can* still get their money back during the claim
window — which arguably means their "obligation" to the seller isn't fully
extinguished yet. **This is a genuinely fact-specific legal question, not something
resolved by this research.**

**Indiana's DFI** has published its own MTMA guidance stating that "a third-party
payment processor acting as an agent is recognized by DFI as not requiring a money
transmitter license," while still recommending applicants "review Indiana law
and...consult legal counsel to confirm"
([Indiana DFI MTMA Licensing Guidance PDF](https://www.in.gov/dfi/files/MTMA-Licensing-Guidance-Updated.pdf))
— a useful data point that even a friendly regulator won't give a blanket yes/no
without looking at the specific facts.

### Bellwether states

**California (DFPI):** California completed rulemaking on its own agent-of-a-payee
exemption, and DFPI's draft rules indicate the exemption **can** apply to "processors
that facilitate transactions on behalf of marketplaces and sellers of goods and
services on behalf of marketplaces"
([Cooley, "California Finalizes Rulemaking for Agent-of-a-Payee Exemption"](https://www.cooley.com/news/insight/2021/2021-06-28-california-rulemaking-agent-of-a-payee-exemption-money-transmission-licensing)).
**Important nuance specific to California**: DFPI opinion letters explicitly
distinguish the agent-of-payee money-transmission exemption from California's
*separate* **Escrow Law** — an "internet escrow agent" that isn't really acting as a
payment-collection agent but is instead functioning as a true escrow holder needs a
*different* license (or a different exemption) under the Escrow Law, not the
money-transmission agent-of-payee exemption
([DFPI opinion letters index](https://dfpi.ca.gov/rules-enforcement/laws-and-regulations/opinion-letters-by-law-subject/agent-of-payee-exemption-for-online-travel-marketplace-payroll-processing-exemption-agent-of-payee-exemption-for-online-marketplace-for-independent-contractors-internet-escrow-agent-not-engaging-in/)).
This matters for word choice: calling a hold mechanism "escrow" in marketing/legal
copy isn't just informal — in California specifically it can point regulators toward
a wholly separate statute.

**New York:** New York has **not** adopted the MTMA and runs its own regime — money
transmitters are licensed under **Banking Law Article 13-B, §641** ("No person shall
engage in the business of...receiving money for transmission or transmitting the
same, without a license")
([NYDFS](https://www.dfs.ny.gov/apps_and_licensing/money_transmitters);
[statute text via Justia](https://law.justia.com/codes/new-york/bnk/article-13-b/641/)).
Separately, NY's **BitLicense** (23 NYCRR 200) is a *different* license for
virtual-currency businesses — not relevant to a fiat-only card marketplace, but worth
knowing to avoid confusing the two.

**Texas:** Texas Finance Code §151.302 requires a license unless exempt or operating
as an authorized delegate. Notably, Texas commentary flags that **escrow services
outside of real-property transactions can themselves fall within the
money-transmission definition** — another state where the word "escrow" and the
underlying activity both matter.

**Florida:** Fla. Stat. §560.103 defines "money transmitter," "payment instrument,"
and "stored value"
([2025 Florida Statutes §560.103](https://www.flsenate.gov/Laws/Statutes/2025/560.103));
§560.104 lists exemptions (banks, credit unions, etc.). **Gap:** whether Florida has
adopted the MTMA or has a codified agent-of-payee exemption comparable to
California's was not confirmed in this research — close this directly with counsel.

---

## 3. Stored-value wallet vs. transaction-specific hold — how the distinction actually gets drawn

This is the crux of the question, and the clearest way it's articulated is the
**contrast between the two 2014 FinCEN rulings** described above: funds held because
they're "necessary and integral" to completing one specific, already-agreed
underlying transaction (escrow ruling, exempt) vs. funds moved as a standalone
service with no such tie (the other 2014 ruling, not exempt).

Legal/industry commentary converges on a few concrete factors that separate the two
patterns:

- **Account/custody structure.**
  [Venable LLP's analysis of the payment-facilitator model](https://www.venable.com/insights/publications/2018/06/money-transmission-in-the-payment-facilitator-mode)
  puts it plainly: "The critical factor is whether funds pass through the payment
  facilitator's account... when processors settle directly to sub-merchants'
  accounts with fees sent separately, money transmission concerns diminish. However,
  when the payment facilitator holds funds in a 'for benefit of' (FBO) account before
  distributing them to sub-merchants, money transmission compliance becomes
  relevant." A wallet, almost by definition, requires the platform (or its processor,
  on the platform's instruction) to hold a balance not tied to any specific
  transaction — closer to the FBO-account, standalone-service end of the spectrum. A
  transaction-tied hold that never leaves the licensed processor's own rails sits
  closer to the exempt end.
- **Whether the value is redeemable/spendable on demand for anything, vs. tied to one
  deal.** A wallet lets a user deposit today and spend/withdraw whenever, for
  whatever. An escrow-style hold is created *because* two identified parties already
  agreed to a specific transaction, and it resolves to exactly one of two outcomes
  tied to that transaction (release to seller, or refund to buyer) — there's no third
  option where the money goes somewhere else.
- **Duration tied to a defined, objective, transaction-completing event** (e.g.,
  delivery confirmation + a bounded claim window) vs. indefinite or discretionary
  holding.
- **Real-world confirmation of this being the harder case:** Mercari — which,
  notably, *does* offer a general "Mercari Balance" stored-value feature to users — is
  licensed as a money transmitter in its own right, including specifically for stored
  value
  ([search-indexed Mercari MTL help page](https://www.mercari.com/us/help_center/topics/trust/policies/mercari-money-transmitter-licenses/)),
  rather than resting on an exemption. Vermont's Department of Financial Regulation
  also has an open regulatory matter titled "In Re: Mercari, Inc."
  ([dfr.vermont.gov](https://dfr.vermont.gov/reg-bul-ord/re-mercari-inc)) — content
  not accessible (403 error), so this is at minimum a signal that state regulators
  have looked closely at Mercari's wallet-adjacent model specifically, not
  confirmation of what the matter concluded. Consistent with — not a refutation of —
  the original instinct that the wallet was the higher-risk piece.

---

## 4. How Stripe positions this for platforms

Verified directly from Stripe's live developer docs (quoted, not just summarized):

**Stripe explicitly does not claim to offer "escrow" as a legal product.** From
Stripe's [manual payouts documentation](https://docs.stripe.com/connect/manual-payouts):

> "Escrow has a precise legal definition, and Stripe doesn't provide escrow services
> or support escrow accounts. However, you can control payout timing through manual
> payouts, which allow you to delay payouts to certain accounts."

This matters: Stripe is telling platforms, in its own docs, that a delayed
transfer/claim-window mechanism is **not** a Stripe-provided legal escrow product —
it's the platform using Stripe's payout-timing controls to build a hold, and the
regulatory characterization of that hold is on the platform, not conferred by Stripe.
Practically, "claim window" or "hold period" is more defensible language than
"escrow" in ToS/marketing, both to avoid overstating what's being offered and to
avoid tripping state-specific escrow-law regimes like California's above.

**On holding periods:** the same page shows manual-payout holding limits by
country — **United States: up to 2 years**, other countries generally 90 days
([Stripe manual payouts doc](https://docs.stripe.com/connect/manual-payouts)). That
2-year ceiling is Stripe's platform limit, not a safe-harbor duration for MTL
purposes — a multi-day or multi-week claim window tied to delivery confirmation is a
completely different regulatory posture than holding funds anywhere near that
ceiling, even though both are technically "within Stripe's limits."

**On charge types**, Stripe's own
[Connect charges overview](https://docs.stripe.com/connect/charges) confirms: with
**destination charges** and **separate charges and transfers**, the platform is the
merchant of record, the charge lands on the platform's Stripe balance first, and the
platform later moves funds to the connected (seller) account via a transfer. Stripe's
[integration recommendations doc](https://docs.stripe.com/connect/integration-recommendations)
is explicit that under this model "the platform is responsible for related negative
balances" and disputes/refunds are debited from the platform's balance — a real
economic and liability structure, not a purely cosmetic one, which is exactly the
kind of fact a regulator would weigh.

**On Stripe's own licensing:** per Stripe's
[Payments Company Licenses page](https://stripe.com/legal/spc/licenses), Stripe is
licensed as a money transmitter across U.S. states and territories, including
specifically by NYDFS. The premise of Stripe Connect for platforms is that as long as
funds move through Stripe's own licensed rails, the *platform* doesn't need to
separately obtain 50-state MTLs — but nothing in Stripe's docs claims this is an
unconditional shield; Stripe's own escrow disclaimer above is Stripe telling
platforms the opposite, i.e., to still think about this.

---

## 5. Real-world precedent

Several marketplaces run a broadly similar buyer-pays → platform/processor briefly
holds → seller-gets-paid-after-a-window pattern. The picture is more varied than
"everyone just relies on an exemption" — some got licensed themselves:

- **eBay.** eBay Managed Payments runs under **eBay Commerce Inc.'s own money
  transmitter license** (NMLS ID 1774459), licensed in New York and other
  jurisdictions ([eBay's own MTL disclosure page](https://pages.ebay.com/ebayCommerce/mtl.html)).
  eBay chose to become a licensed money transmitter rather than rely purely on an
  exemption for its Managed Payments flow — a notable data point given eBay is the
  closest structural analog to this business.
- **Mercari.** As discussed above, licensed as an MTL itself, including for stored
  value; processes card payments through Stripe.
- **Etsy.** Etsy Payments uses a **Payment Account Reserve** mechanic — Etsy can hold
  a percentage of a seller's funds (up to 75% in flagged cases) for a defined period,
  released on valid tracking or after a set number of days (45–90 typical)
  ([Etsy Payments Policy](https://www.etsy.com/legal/etsy-payments/);
  [Etsy Help: Payment Account Reserve](https://help.etsy.com/hc/en-us/articles/360058722214-What-is-a-Payment-Account-Reserve)).
  Etsy's own MTL licensing status for this specific research pass was not confirmed —
  flagging as a gap rather than guessing.
- **Poshmark.** Funds are held and released roughly 3 days after delivery/buyer
  acceptance; payouts run through **Hyperwallet**, a PayPal-owned service
  ([Poshmark's own payout guide](https://poshmark.com/posh_guide/how_to_get_paid)).
  PayPal/Hyperwallet independently holds MTLs, suggesting Poshmark may be leaning on
  its processor's licenses rather than its own — not independently confirmed here.
- **Reverb.** Payout is initiated 1–2 business days after delivery confirmation
  (first sale) or upon valid tracking thereafter, under "Reverb Protection" for both
  buyer and seller
  ([Reverb Payments Terms](https://reverb.com/page/us-reverb-payments-terms);
  [Reverb seller protection help](https://help.reverb.com/hc/en-us/articles/40917615337755-How-does-Reverb-protect-sellers)).
  Notably, Reverb **partners with Escrow.com** — a separately, state-licensed escrow
  company — specifically for its high-value gear program
  ([Escrow.com/Reverb partnership page](https://www.escrow.com/learn-more/partners/reverb)),
  rather than badging its standard payment-hold flow as "escrow." A useful real-world
  illustration of the word-choice point above: when Reverb actually wants legal
  escrow, they route to a licensed escrow provider instead of calling their normal
  hold "escrow."
- **StockX.** Seller payouts run through **Hyperwallet** (PayPal) after order
  authentication completes
  ([StockX seller payout help](https://stockx.com/help/articles/as-a-seller-how-and-when-do-i-get-paid)).
- **Depop** (Etsy-owned). Payments run on Stripe's infrastructure; sellers are
  typically paid ~2 days post-delivery, and disputes freeze funds pending resolution.
  Sourced from a secondary consumer-guide blog, not a primary Depop/Etsy legal
  source — directional only.

**Takeaway:** there is no single dominant industry pattern. Some direct comparables
(eBay, Mercari) simply got licensed. Others appear to lean on a licensed processor
(Stripe, PayPal/Hyperwallet) as the entity actually holding/moving the money,
structuring themselves as an exempt facilitator on top. Both are legitimate paths —
which one is right here is a business/cost tradeoff as much as a legal one, and it's
exactly the kind of decision a payments attorney should weigh in on given actual
volume and risk tolerance.

---

## 6. What actually creates risk — synthesized factors

Pulling together the FinCEN ruling contrast, the Venable FBO-account analysis, the
MTMA agent-of-payee three-part test, California's escrow-law carve-out, and Stripe's
own escrow disclaimer, here's the pattern of factors practitioners and regulators
point to:

- **Where custody actually sits.** Funds staying inside Stripe's own licensed
  ledger/balance the whole time (destination charges, separate charges and
  transfers, delayed payout — all Stripe-native mechanisms) is a fundamentally
  different fact pattern from sweeping funds into the platform's own operating bank
  account and manually tracking/disbursing them. The latter is what the Venable
  article flags as the point where "money transmission compliance becomes
  relevant."
- **Transaction-specificity.** Funds tied, at the moment of receipt, to one
  identified sale between two identified parties (this buyer, this seller, this
  listing) — vs. a generic balance not yet attached to a purchase.
- **Duration and definiteness of the hold.** A hold that's bounded and tied to an
  objective, transaction-completing trigger (e.g., delivery confirmation, then a
  fixed claim window) reads as "necessary and integral" per FIN-2014-R004's own
  language. An indefinite, discretionary, or open-ended hold reads differently.
- **No redirect-ability.** In a wallet, a user can spend/withdraw the balance for
  anything. In a clean transaction-specific hold, the money has exactly two possible
  destinations (seller, on release; buyer, on refund) and no third option.
- **No accumulation/reuse of a balance.** A design where a seller's payouts sit and
  build up in-platform (even briefly, as a matter of product design rather than
  technical necessity) starts to look wallet-like again — the trap to watch for even
  inside an otherwise transaction-tied design.
- **Written agreements + public "holding out."** The MTMA agent-of-payee test
  literally requires a written agreement authorizing the platform to collect on the
  seller's behalf, and requires the seller to hold the platform out publicly as doing
  so — meaning Seller ToS language isn't boilerplate here, it's load-bearing for the
  exemption theory itself.
- **Word choice.** "Escrow" is not a neutral marketing word — in states like
  California it's tied to a separate licensing statute (the Escrow Law), and Stripe
  itself avoids using it for its own payout-delay tooling. "Claim window," "hold,"
  "delayed transfer" are safer default vocabulary pending legal review.
- **Being merchant of record isn't automatically bad**, and isn't the same axis as
  MTL risk — it's expected in the payment-facilitator/agent-of-payee model, and it's
  what destination charges/separate charges and transfers structurally impose. It
  does, however, concentrate other liabilities on the platform (sales tax
  collection, chargeback/dispute exposure, consumer-protection obligations) that are
  worth flagging to counsel alongside the MTL question, even though they're legally
  distinct issues.

### Quick self-check list (sanity-check a design against this before the lawyer call — not a substitute for the lawyer call)

**Leans toward "likely exempt":**
- Funds never leave Stripe's own balance/ledger until the final transfer to the
  seller's connected account — no sweep to the platform's own bank account.
- Every dollar is attached, at receipt, to one specific already-agreed sale (buyer +
  seller + listing all known).
- The hold has a fixed, objective release trigger tied to completing that sale
  (delivery confirmation + a bounded claim window), not an open-ended or
  discretionary hold.
- No user-facing "balance," "wallet," "add funds"/"top up" flow, and no ability for a
  buyer or seller to spend or withdraw held funds for anything other than the
  transaction that generated them.
- Seller ToS contains a real written agent-of-payee-style authorization, and the
  seller-facing product actually presents the platform as collecting payment on the
  seller's behalf.
- The hold isn't marketed/documented as "escrow" without having actually checked
  whether that word triggers a separate state licensing regime (California in
  particular).

**Leans toward "likely triggers MTL exposure":**
- Platform sweeps the Stripe balance into its own operating account and manually
  tracks/pays sellers from there.
- Buyers can pre-fund a balance not tied to a specific purchase, or sellers can let
  payouts accumulate/sit as a running balance rather than flowing straight through.
- Hold periods are indefinite, adjustable at the platform's discretion for reasons
  unrelated to completing that specific sale, or used as float/working capital.
- Product copy uses "wallet," "deposit," "escrow" language that doesn't match what's
  actually happening underneath.
- The platform, not Stripe, is the one with real economic custody of the money for
  any meaningful stretch of time.

---

## This is not legal advice

Everything above is background research to help have a more informed conversation
with an actual attorney — **it is not legal advice, it does not constitute legal
advice, and it should not be relied on as the basis for launching a payment flow that
touches real money.** A few things worth being explicit about:

- **Money transmission law in the U.S. is a genuine 50-state-plus-federal patchwork.**
  Even within the 31 states that have adopted the MTMA, exemption qualification is
  fact-specific, and the roughly 19 states that haven't (fully or at all) may have
  materially different exemption language, different agent-of-payee tests, or none
  at all. New York alone runs its own separate regime. Several states' exact
  statutory text (Florida's, for instance) was not confirmed in this research — those
  gaps need to be closed by counsel, not assumed favorably.
- **Whether a specific fund flow qualifies for the goods/services exemption, the
  payment-processor exemption, or a given state's agent-of-payee exemption is a
  fact-intensive legal determination**, not something that can be settled by matching
  a design against a checklist like the one above. The checklist is a sanity-check
  tool, not a legal conclusion.
- **Actual payments/fintech regulatory counsel should review the specific
  implementation** — the exact charge type, the exact fund-flow diagram (does
  anything ever touch a bank account the platform controls?), hold duration, the
  precise release/refund trigger mechanics, and ToS language — before processing real
  transactions at any meaningful scale, and ideally before writing the code that
  finalizes the flow.
- Given that this is the second time this team has approached a payments-holding
  design (the first, the wallet, was pulled specifically over this exact risk), it's
  worth treating the legal review as a gating step for this design too — not a
  formality to check off after building it, but a review of the actual architecture
  before it goes live with real money.

---

**Sources cited throughout:**
- [31 CFR 1010.100 — Cornell LII](https://www.law.cornell.edu/cfr/text/31/1010.100)
- [FinCEN Ruling FIN-2014-R004 (PDF)](https://www.fincen.gov/sites/default/files/administrative_ruling/FIN-2014-R004.pdf) / [FinCEN.gov listing](https://www.fincen.gov/resources/statutes-regulations/administrative-rulings/application-money-services-business-1)
- [Lexology summary of 2014 FinCEN rulings](https://www.lexology.com/library/detail.aspx?g=3c38983d-4b1d-4aab-b15a-62f413c33677)
- [CSBS MTMA overview](https://www.csbs.org/csbs-money-transmission-modernization-act-mtma) / [state adoption tracker](https://www.csbs.org/state-pending-enacted-mtma-legislation)
- [Indiana DFI MTMA Licensing Guidance (PDF)](https://www.in.gov/dfi/files/MTMA-Licensing-Guidance-Updated.pdf)
- [Cooley: California agent-of-a-payee rulemaking](https://www.cooley.com/news/insight/2021/2021-06-28-california-rulemaking-agent-of-a-payee-exemption-money-transmission-licensing)
- [California DFPI opinion letters](https://dfpi.ca.gov/rules-enforcement/laws-and-regulations/opinion-letters-by-law-subject/agent-of-payee-exemption-for-online-travel-marketplace-payroll-processing-exemption-agent-of-payee-exemption-for-online-marketplace-for-independent-contractors-internet-escrow-agent-not-engaging-in/)
- [NYDFS Money Transmitters](https://www.dfs.ny.gov/apps_and_licensing/money_transmitters) / [NY Banking Law §641](https://law.justia.com/codes/new-york/bnk/article-13-b/641/)
- [Florida Statutes §560.103](https://www.flsenate.gov/Laws/Statutes/2025/560.103)
- [Venable LLP: Money Transmission in the Payment Facilitator Model](https://www.venable.com/insights/publications/2018/06/money-transmission-in-the-payment-facilitator-mode)
- [Stripe: Connect charges overview](https://docs.stripe.com/connect/charges)
- [Stripe: Integration recommendations](https://docs.stripe.com/connect/integration-recommendations)
- [Stripe: Manual payouts (escrow disclaimer)](https://docs.stripe.com/connect/manual-payouts)
- [Stripe Payments Company licenses](https://stripe.com/legal/spc/licenses)
- [eBay Commerce Inc. Money Transmitter Licenses](https://pages.ebay.com/ebayCommerce/mtl.html)
- [Mercari Money Transmitter Licenses](https://www.mercari.com/us/help_center/topics/trust/policies/mercari-money-transmitter-licenses/) / [Vermont DFR: In Re Mercari](https://dfr.vermont.gov/reg-bul-ord/re-mercari-inc)
- [Etsy Payments Policy](https://www.etsy.com/legal/etsy-payments/) / [Etsy Payment Account Reserve](https://help.etsy.com/hc/en-us/articles/360058722214-What-is-a-Payment-Account-Reserve)
- [Poshmark: How Do I Get Paid](https://poshmark.com/posh_guide/how_to_get_paid)
- [Reverb U.S. Payments Terms](https://reverb.com/page/us-reverb-payments-terms) / [Reverb seller protection](https://help.reverb.com/hc/en-us/articles/40917615337755-How-does-Reverb-protect-sellers) / [Escrow.com–Reverb partnership](https://www.escrow.com/learn-more/partners/reverb)
- [StockX seller payout help](https://stockx.com/help/articles/as-a-seller-how-and-when-do-i-get-paid)
