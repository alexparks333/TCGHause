# AuctionHous - TCG — Engineering Guide

This is the initial engineering guide for building AuctionHous - TCG: a P2P auction and
fixed-price marketplace for trading cards and graded slabs, undercutting TCGplayer/eBay
fee structures (a 5.5–7% tiered seller commission + $0.30, Gold-tier headline of "6% +
$0.30" quoted against eBay's ~13.6%) via Stripe Connect **direct charges** — money goes
straight to the seller's own Stripe account, never a platform-held balance.
**The originally-planned pre-funded site wallet is removed, not on hold pending a
redesign** — see the note at the top of §5.1 and §7; this file still describes the old
wallet architecture below so the history is legible, but no wallet code exists in the
repo, and the direct-charge model isn't a stopgap, it's the actual resolution to the
money-transmitter exposure that shut the wallet down (see `docs/PercentageModel.md` §11).

**Source of truth for the business model:** [`docs/PercentageModel.md`](docs/PercentageModel.md)
for every fee/tier/payout number (supersedes the flat-2%/wallet-based numbers below and
in `docs/design-doc.md`, which is now "v1" — kept for its escrow-timer and dispute-protocol
detail, which PercentageModel.md doesn't repeat, but its 2.0% flat fee and 3-tier seller
system are stale). This file does not repeat that content — it translates it into a
concrete system architecture, borrowing heavily from eBay's 25+ years of battle-tested
marketplace mechanics, adapted to the TCG/collectibles domain and our 5.5–7% margin.
**Known follow-up, not yet done:** §6.4 below ("Seller tiers & performance standards")
and §4 ("Core domain model")'s `SellerTierState` still describe design-doc.md's old
Tier 1/2/3 ladder, not PercentageModel.md's real New/Bronze/Silver/Gold/Haus Trust
5-tier system — that section needs a pass to match, separate from this fee-number fix.

**Status:** the repo now has a working scaffold — `apps/web` (marketplace homepage +
listing detail pages, mock data), `apps/api` (Go module, builds and boots), and a real
account-creation flow (`/signup`, `/login`) wired to Supabase Auth. See §6.12 for how
that's wired, and `docs/infra-cost-analysis.html` for why Supabase.

---

## 1. Why eBay is the reference architecture

eBay solved most of the hard problems a P2P auction marketplace runs into — proxy
bidding, sniping, category-specific structured data, reputation at scale, low-friction
dispute resolution, seller risk tiers. We are not reinventing these; we are re-implementing
proven versions of them, scoped to cards, and fused with the design doc's wallet/escrow
model, which eBay itself doesn't need (it uses direct payment processing, not a
pre-funded wallet). Every subsystem below names the eBay mechanic it's adapted from and
what we're changing and why.

---

## 2. Repo layout (prescriptive)

```
auctionhous-tcg/
├── apps/
│   ├── web/                       # Next.js frontend (buyer + seller + admin surfaces)
│   │   ├── app/                   # route groups: (buyer)/, (seller)/, (admin)/
│   │   ├── components/
│   │   └── lib/                   # API client generated from packages/shared-contracts
│   │
│   └── api/                       # Go backend, single module
│       ├── cmd/
│       │   ├── api/               # HTTP + WebSocket server entrypoint
│       │   ├── worker/            # async jobs: escrow release, auction close, tier recompute
│       │   └── migrate/           # DB migration runner
│       ├── internal/
│       │   ├── auction/           # proxy bidding, soft-close timer, Redis-backed bid state
│       │   ├── listing/           # listing CRUD, category/item-specifics validation
│       │   ├── catalog/           # category tree + item-specifics schema (games/sets/cards)
│       │   ├── escrow/            # escrow state machine, release triggers
│       │   ├── order/             # checkout, cart batching for sub-$20 singles
│       │   ├── seller/            # tier calculation, performance standards, listing caps
│       │   ├── dispute/           # resolution-center state machine
│       │   ├── feedback/          # ratings, detailed-rating axes, defect rate
│       │   ├── grading/           # PSA/BGS/CGC cert verification
│       │   ├── shipping/          # label purchase, carrier webhooks, delivery confirmation
│       │   ├── search/            # ranking + filtering over listings
│       │   ├── notification/      # email/push/websocket alerts, watchlist triggers
│       │   └── platform/          # auth, middleware, config, telemetry, idempotency keys
│       ├── pkg/                   # dependency-free shared libs (money type, id generation)
│       └── migrations/            # SQL migrations (golang-migrate)
│
│       # internal/wallet/ existed as a doc-only stub and was removed (§5.1, §7) —
│       # not scaffolded prematurely elsewhere either; re-add once legal signs off.
│
├── packages/
│   └── shared-contracts/          # OpenAPI spec; generates the Go server stubs + TS client
│
├── infra/
│   └── docker-compose.yml         # local dev: postgres, redis, minio (S3-compatible)
│
├── docs/
│   └── design-doc.md              # business design doc (source of truth for the model)
│
├── CLAUDE.md
└── README.md
```

`apps/api` is one Go module with internal packages, not a microservices mesh — split
into separate deployables later only if a specific package (e.g. `auction`, which is
the most latency-sensitive) actually needs independent scaling.

**`apps/mobile/` (React Native + Expo) is a deliberate v2 addition, not scaffolded yet.**
Decision: build the Next.js web app first; add the iOS app once the web marketplace has
real listings/liquidity, reusing `packages/shared-contracts`' generated TypeScript client
so the API layer isn't rewritten. Chosen over wrapping the web app in Capacitor because
card-condition photo capture and outbid/auction push alerts — the two flows that matter
most here — need real native camera/notification ergonomics. See §9, open question 5.

---

## 3. Tech stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js + Tailwind | SEO-indexable listing pages (organic search is a real acquisition channel for a new marketplace, same reason eBay listings rank in Google); React ecosystem for a bidding UI with live updates. |
| Backend | **Go** | Chosen over Node/NestJS for the real-time bidding engine: goroutines + channels make the auction close/soft-close timer logic (thousands of concurrent per-auction timers) simpler and cheaper to run correctly than event-loop-based concurrency, and a static type system matters when the codebase is moving money. |
| Primary DB + Auth | **Supabase** (managed Postgres + Auth + file storage, one bill) | ACID Postgres for escrow/orders, plus a login system with real security scrutiny behind it, without a growing per-user auth tax at scale. Go connects to the underlying Postgres directly via `DATABASE_URL` — never through Supabase's client SDK. Full cost comparison against rolling our own / Clerk / Cognito: `docs/infra-cost-analysis.html`. See §6.12. |
| Real-time / locks | Redis | Auction current-price/high-bidder state, distributed bid locks, rate limiting. Redis is the scratch pad; Postgres is the record of truth — every auction's final state is persisted to Postgres, Redis just holds the hot path during bidding. |
| Payments | Stripe Connect (on hold) | Escrow-adjacent balance holding, seller payouts — **wallet deposits specifically are on hold pending legal review**, see §7. Stripe Connect is still the right target once that review clears, so the choice stands, just not built yet. |
| Media | **Supabase Storage** (not Cloudflare R2/S3 as originally listed) | Card photos, uploaded during the Sell wizard. Reuses the already-provisioned Supabase project — no second external storage account to set up. See §6.13. R2 is still worth revisiting if egress volume ever makes its zero-egress pricing matter (`docs/infra-cost-analysis.html`), but that's a scale problem, not a v1 one. |
| Search (v1) | Postgres full-text + trigram + item-specifics filters | No dedicated search engine at launch — see §6.7. |

---

## 4. Core domain model

| Entity | Purpose |
|---|---|
| `User` | Buyer/seller identity, KYC/ID-verification status (required for Tier 3). Row is synced from Supabase's `auth.users` by a trigger, not created directly — see §6.12. |
| `Wallet` / `LedgerEntry` | **Removed for now, see §5.1/§7.** Was to be an append-only double-entry ledger per user (never a mutable balance column) — the design is preserved here as the target shape for when it's rebuilt, not as a description of current code. |
| `Category` / `ItemSpecificSchema` | The TCG-adapted version of eBay's category tree + item aspects (see §6.2). |
| `Listing` | A single card or slab for sale: fixed-price, auction, or both (auction with Buy-It-Now). |
| `Auction` / `Bid` | Proxy-bid state, current price, soft-close end time. |
| `Order` | A completed purchase or auction win; links buyer, seller, listing(s), cart batch. |
| `EscrowHold` | State machine: `held → release_pending → released` or `→ disputed → refunded`. |
| `Shipment` | Carrier, tracking number, delivery confirmation, PWE-vs-tracked flag. |
| `Dispute` | Resolution-center case: negotiation → escalation → decision → appeal. |
| `FeedbackRating` | Overall pos/neutral/neg + detailed-rating axes (see §6.3). |
| `SellerTierState` | Recomputed periodically from `Order`/`Dispute`/`FeedbackRating` history, never hand-set. |
| `GradingVerification` | Cert-number lookup result from PSA/BGS/CGC for graded-slab listings. |

---

## 5. Engineering principles (non-obvious, must-follow)

These are the rules that are easy to violate accidentally and expensive to get wrong
in a system that moves real money on a 5.5–7% margin.

**5.1 The wallet is removed for now — wallet deposits are on hold pending legal review
of money-transmitter licensing exposure (§7), explicit product decision.** The
`wallet_ledger_entries` table, `internal/wallet` package (was doc-only, never had real
logic), and the header's wallet-balance nav link have all been removed
(`migrations/0007_remove_wallet.up.sql`). The design principle below is preserved as
the target shape for whenever this is rebuilt post-legal-review, not a description of
anything currently in the codebase: **the wallet must be an append-only double-entry
ledger, never a mutable balance field.** Balance = `SUM(ledger_entries.amount) WHERE
user_id = ?`, always derived, never stored and mutated in place — this is what makes
the platform reserve, chargeback defense fund, and audits in §4.2 of the design doc
actually reconcilable instead of "trust the code was right." Don't re-add any of this
without an explicit go-ahead — see §9 open question 4.

**5.2 Every order/escrow transition is one state machine, not scattered boolean flags.**
`held → release_pending → released` and the disputed branch must be modeled explicitly
(a `status` enum + transition table), because escrow release timing (§3 of the design
doc) is the thing a support agent, a refund, and a fraud reviewer all need to reason
about identically.

**5.3 Bid placement is the only writer of auction state, and it must be race-safe.**
Use Redis with optimistic versioning (or `WATCH`/`MULTI`) per auction key — two
simultaneous bids on the same $10,000 slab must never both "win." Never let an API
read-replica's lag decide what the current high bid is.

**5.4 Seller tier is always recomputed from history, never cached as the only truth.**
Store the inputs (sales count, dispute count/rate, feedback score) and derive tier on
read or on a scheduled job — mirrors eBay's monthly seller-standards re-evaluation
(§6.4). This is what makes tier demotion, appeals, and "why was I downgraded" support
tickets answerable.

**5.5 Grading cert verification must call a real lookup, never a stub, before a slab
listing goes live at Tier 2/3 trust levels.** Counterfeit slabs are the fraud vector the
design doc names explicitly (§6, "Fake Slab" claims) — a stubbed "always valid" check
here is a shipped vulnerability, not a TODO.

---

## 6. eBay-informed subsystem designs

### 6.1 Auction & bidding engine

eBay's mechanic: **proxy bidding** — a bidder sets a private max; the system bids up
only as far as needed to beat the current second-highest max, in fixed increments.
eBay also piloted **soft close / auto-extend** (any bid in the final 2 minutes extends
the auction) as an anti-sniping experiment — this was originally recommended here too,
but **overridden by explicit product decision**: AuctionHous uses a fixed hard end
time, matching eBay's actual long-standing classic default. Whoever holds the highest
bid the instant the clock hits zero wins, period — no extension.

- `internal/auction` stores each bidder's max privately; only the current price and
  high-bidder (not the max) are ever exposed to other bidders or the client.
- Implemented directly against Postgres (`auctions.version` optimistic concurrency)
  rather than the Redis-backed hot path described below — see §6.12-adjacent note in
  `internal/auction/doc.go`. Redis is a scale optimization for high concurrent-bid
  traffic on one auction, not a correctness requirement; not needed until real traffic
  justifies it.
- Original Redis design, deferred: auction state in a `auction:{id}` hash
  (current_price, high_bidder, end_time, version) during the live window, with final
  state persisted to Postgres on close.

### 6.2 Category taxonomy & item specifics

eBay's mechanic: a **category tree** plus, per leaf category, a set of **item
specifics/aspects** marked required/recommended/optional (color, size, etc. — fetched
via `getItemAspectsForCategory`). This structured data is what makes faceted search and
listing-quality scoring possible.

TCG-specific schema (the direct translation):

| Field | Applies to | Required? |
|---|---|---|
| Game | All | Required (Pokémon / MTG / Yu-Gi-Oh! / Lorcana / Riftbound / Sports) |
| Set / Series | All | Required |
| Card Number | All | Required |
| Rarity | All | Recommended |
| Language | All | Recommended |
| Edition (1st/Unlimited) | MTG/Pokémon vintage | Optional |
| Foil/Holo | All | Recommended |
| Condition — Raw | Ungraded listings | Required (NM/LP/MP/HP/DMG) |
| Grading Company + Grade + Cert # | Graded slab listings | Required, feeds `GradingVerification` |

Model this as a `category_item_specifics_schema` table (category → field → required
tier), not hardcoded per-form logic — new games (whatever launches after Riftbound)
should be addable via data, not a code change, exactly like eBay's own category-tree
updates don't require client releases.

### 6.3 Feedback & reputation

eBay's mechanic: an overall positive/neutral/negative score shown as a percentage, plus
**Detailed Seller Ratings** on 4 fixed axes (item-as-described accuracy, communication,
shipping time, shipping/handling cost), 1–5 stars, only surfaced after a minimum rating
count. DSRs don't move the headline score but gate seller-benefit eligibility.

Adapt the 4 axes for cards, with condition accuracy promoted to the most-weighted axis
since it's the design doc's primary dispute trigger:
1. **Condition/Grade Accuracy** (highest weight — feeds dispute-risk scoring directly)
2. Communication
3. Shipping Speed
4. Shipping/Handling Value

### 6.4 Seller tiers & performance standards

The design doc's Tier 1/2/3 system (§4.1) *is* our version of eBay's seller-standards
tiers — keep it, but borrow two operational details from eBay that the design doc
doesn't spell out:

- **Recompute on a schedule, not just forward-only.** eBay re-evaluates seller level
  monthly and can demote ("Below Standard") as well as promote. Implement tier as a
  scheduled job output (§5.4), so a seller who starts racking up disputes drops back to
  a stricter escrow hold automatically — the design doc's "Bad Actor Threshold" (2
  disputes/30 days) should trigger this same recompute path, not a separate ad-hoc check.
- **New-account limits mirror eBay's $500/10-item new-seller cap.** The design doc's
  Tier 1 $200 listing cap is already stricter (appropriate — thinner margin, less room
  for fraud loss), keep it as-is.

### 6.5 Dispute resolution

**Status: built, not just designed.** `internal/dispute` is a real, live state machine
(negotiation, auto-adjudication, Stripe refund execution, one-appeal ladder) — the
design below is what it was built from, not a plan still waiting on implementation.
Ticket numbers and a real Workers-side queue/decide UI for the human-review path
covered here are in §6.17.

eBay's mechanic (Money Back Guarantee / Resolution Center): buyer opens a case →
seller has a fixed window to respond with evidence (tracking, photos) → escalate to
eBay → decision → **30-day appeal window**. Seller protection hinges on having shipped
within stated handling time *and* providing tracking (signature confirmation required
above $750).

The design doc's flow (§6) already matches this shape — direct negotiation (48h) →
admin audit → decision. Two additions worth carrying over:
- **Signature confirmation threshold for high-value escrow items** (e.g., graded slabs
  over some dollar amount) — mirrors eBay's $750 rule, gives an objective evidence bar
  admins can use instead of subjective judgment calls.
- **An explicit appeal window** after an admin decision. eBay gives 30 days; given our
  thinner margin and desire to close cases fast, a shorter window (7–10 days) is
  probably right — **this is a call for you, not decided here** (see open questions).

### 6.6 Grading / authenticity verification

eBay's mechanic (Authenticity Guarantee): eligible cards above a price threshold are
physically shipped to a third party (PSA, eBay's partner) for inspection before
forwarding to the buyer — sealed-holder tamper checks for graded slabs, corner/edge/
surface inspection for raw cards.

We do not have physical-inspection infrastructure at launch, so scope this down for v1:
- **v1:** `internal/grading` does **cert-number lookup verification only** — call the
  grading company's public cert-lookup (PSA/BGS/CGC) to confirm a cert number is real
  and matches the claimed card/grade, plus require the high-res photos the design doc
  already mandates (§5).
- **v2/v3:** physical ship-to-inspect, matching eBay's model, requires an actual
  authentication partnership (like eBay's with PSA) — flag this as a business
  development dependency, not something to build speculatively now.

### 6.7 Search & discovery

eBay's mechanic (Cassini): ranks listings by predicted buyer satisfaction, roughly
40–50% relevance, 30–40% seller performance, 20–30% listing quality (item-specifics
completeness, engagement signals like watch-adds).

- **v1 (partially built, see §6.14):** a real search box and category filter exist —
  `?q=` (title `ilike`) and `?game=` on `GET /listings`, sorted by recency (`created_at
  desc`). This is a starting point, not the full v1: still a plain `ilike`, not
  Postgres full-text/trigram, and no relevance or price sorting yet. Do not build a
  learned ranking function before there's enough transaction data to tune one
  against — that's premature optimization eBay itself only did after years of scale.
- **v2:** once there's traffic, layer in a Cassini-style weighted score (relevance +
  seller tier + listing completeness + watchlist engagement). Dedicated search engine
  (Meilisearch/Elasticsearch) is the upgrade path if Postgres full-text stops scaling,
  not a v1 requirement.

### 6.8 Watchlist, saved searches, alerts

Standard CRUD + `internal/notification`, low-risk to build early. Double-purpose: these
are also the engagement signals §6.7's v2 ranking will eventually consume, so store
watch-add events even before ranking uses them.

### 6.9 Bulk listing tools & seller API

eBay's mechanic: Seller Hub CSV/XLS bulk upload plus a REST Inventory API, gated as a
power-seller tool. This is explicitly a Tier 3 perk in the design doc (§4.1) — build
`internal/listing` with a bulk-CSV endpoint and a documented REST API from the start,
gated by tier check, rather than retrofitting API access onto a UI-only listing flow
later.

### 6.10 Promoted Listings (ads) — explicitly out of v1 scope

eBay's advertising dashboard (cost-per-sale promoted placement) is a mature-marketplace
monetization layer that depends on having organic listing volume and buyer traffic
first. **Do not build this in v1** — note it here so it isn't accidentally scoped into
early work; revisit once there's real marketplace liquidity.

### 6.11 Shipping

Not really an eBay-specific mechanic to borrow so much as an integration point: use a
shipping API (Shippo/EasyPost) for label purchase across USPS/UPS, and ingest carrier
webhooks for delivery confirmation — that webhook is what drives the escrow release
timers in design doc §3 (24h post-delivery for tracked, 6 business days post-"shipped"
for PWE). Keep v1 **domestic-only**; eBay's Global Shipping Program / international
shipping is a real feature but a whole additional compliance surface (customs, duties)
not worth taking on before domestic liquidity exists.

The design doc's "Ship to Platform Vault" (§5) is a v2+ feature — it implies physical
warehouse operations, not just software, so don't let it block v1 scope.

### 6.12 Accounts & authentication

Not an eBay mechanic so much as a build-vs-buy call, made against the numbers in
`docs/infra-cost-analysis.html`: **Supabase** for Postgres + Auth + file storage as one
bundled service, chosen over rolling our own auth in Go or a dedicated auth-as-a-service
(Clerk, AWS Cognito) — those cost more at the 10k–100k user range specifically because
they meter auth per user, while Supabase folds it into the same flat plan as the
database.

How the pieces fit together:

- **The Go API never sees a password.** Supabase Auth issues a JWT on
  signup/login (`apps/web`'s Supabase clients call `supabase.auth.signUp` /
  `signInWithPassword` directly). `apps/api/internal/platform/auth.go` verifies that
  JWT against the project's JWKS (`keyfunc` + `golang-jwt/v5`) and extracts the user id
  from the `sub` claim — that's the entire trust boundary between frontend and backend.
- **`auth.users` (Supabase-managed) is mirrored into `public.users` (ours)** by a
  Postgres trigger (`apps/api/migrations/0002_supabase_auth_sync.up.sql`), so every
  other table's foreign keys (listings, orders, and wallet while it still existed)
  point at a table we own and can migrate away from later, not at Supabase's internal
  schema.
- **RLS is enabled with zero policies** on `public.users` — deny-by-default for
  PostgREST's anon/authenticated roles. The Go API's direct `DATABASE_URL` connection
  (the `postgres` role) bypasses RLS entirely, which is the point: even a leaked
  publishable key can't read or write those tables through Supabase's REST layer, only
  through our own API. (This migration originally also enabled RLS on
  `wallet_ledger_entries`; that table was dropped in `0007_remove_wallet`, §5.1.)
- **Frontend** needs three Supabase SSR clients per Next.js's current
  `@supabase/ssr` pattern: `lib/supabase/client.ts` (browser, for the signup/login
  forms), `lib/supabase/server.ts` (Server Components, e.g. `Header` reading the
  session), and `lib/supabase/middleware.ts` wired into `proxy.ts` (Next.js 16 renamed
  `middleware.ts` → `proxy.ts`; the exported function is now named `proxy`) to refresh
  the session cookie on every request.
- **Graceful degradation on purpose:** until a real Supabase project exists and
  `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` are set, the site still renders — just
  logged-out everywhere, and the Go API skips registering `/me` with a warning instead
  of crashing at startup. Check `isSupabaseConfigured()` (`apps/web/lib/supabase/is-configured.ts`)
  before adding any new Supabase call site on either the frontend or backend.
- **Exit ramp if this ever needs to change:** because the Postgres data is ours either
  way, moving off Supabase Auth later is a migration (export users, force a password
  reset, point the Go API at a self-rolled auth flow), not a rewrite of the rest of the
  marketplace.

**Google sign-in (OAuth):** `GoogleSignInButton` (used on both `/signup` and
`/login` — Supabase's `signInWithOAuth` creates the account on first use, so one button
serves both flows) calls `supabase.auth.signInWithOAuth({ provider: 'google' })`, which
redirects to Google, then to Supabase's fixed `/auth/v1/callback`, then back to our own
`app/auth/callback/route.ts`. That route handler calls `exchangeCodeForSession(code)`
server-side (the second half of the PKCE flow — this is why the callback has to be a
real server route, not a client redirect target) and sets the session cookie before
redirecting home. Two things only a human can configure, outside this repo: a Google
Cloud Console OAuth Client ID, and pasting its credentials into Supabase's Auth
provider settings — see the one-time setup list in §10.

### 6.13 Listings & bidding (real, not mock)

The first non-account domain data, and the point where the frontend stopped rendering
any mock arrays for listings. `apps/api/migrations/0003_listings.up.sql` adds
`listings`, `auctions` (1:1 with an auction-format listing — current price, high
bidder, `version` for optimistic concurrency), and `bids` (every bidder's private max,
never exposed to other bidders). `internal/catalog` hardcodes the six-game enum for
now rather than building the dynamic per-category schema table §6.2 describes
long-term — that's real v2 scope, not something to build before there's a second
reason to.

- **`internal/listing`**: create/get/list, seller-scoped browse for the "Selling"
  page. Every listing response includes `sellerEmail` (a real join, not a fabricated
  seller name/feedback%/tier — those don't exist yet, see §6.3/§6.4, so the frontend
  doesn't pretend they do).
- **`internal/auction`**: `PlaceBid` implements real proxy bidding (§6.1) — the exact
  math is in `auction.go`'s comments — and a fixed hard-close end time. **No
  soft-close/auto-extend**: this was in the original design (§6.1) but was explicitly
  overridden — whoever holds the highest bid when the clock hits zero wins, matching
  eBay's actual classic default, not the auto-extend pilot. Sellers can't bid on their
  own listings (`ErrSelfBid`). Race-safety (two simultaneous bids can never both win)
  is verified, not assumed — see the concurrent-curl test in this feature's history.
  **Bid increments are a 3-tier product decision** (`minIncrement` in `auction.go`,
  overriding eBay's more granular schedule): under $50 moves in $0.25 steps, $50–$500
  in $1 steps, $500+ in $10 steps. A bidder's own max is never snapped to that grid —
  they can bid any exact amount (e.g. $72.50) — the tiers only govern how far the
  *visible* price rises to beat a challenger, capped at whichever bidder's max is
  lower. **The visible price itself always lands on a clean grid point, via
  `roundUpPastGrid`** — real bug found through live manual testing: at $70 current
  price with a $100 leader max, a $72.50 challenge was landing the visible price on
  $73.50 (challenger's exact odd-cents bid + the $1 increment) instead of the correct
  $73.00 (rounded up past the $1 grid). Fixed by rounding the amount-to-beat up to the
  next grid multiple *before* comparing/capping, rather than adding a flat increment
  to whatever odd-cents number a bidder happened to enter. Verified against both the
  original hand-worked example ($2 starting → $5 challenge → $2.25 visible; $6
  counter-bid → $5.25, original bidder wins) and the regression case ($70/$100/$72.50
  → $73.00, leader retains the win) — see this feature's history for the live curl
  traces of both.
  **Auction length is a validated allowlist** (`auctionDuration` in
  `internal/listing/listing.go`, checked in `Create`): 2 days, 3.5 days, or 7 days for
  real listings. A `durationMinutes` of 1/2/5 minutes is also accepted, but only when
  `listing.AllowDevDurations` is true — set in `cmd/api/main.go` from
  `platform.Config.Environment` (`APP_ENV`, defaults to `"development"`, so these are
  on by default until `APP_ENV=production` is set somewhere). Exists purely to dissect
  the bidding engine without waiting days per test auction — the Sell wizard's
  duration `<select>` (`Step3Price.tsx`) only renders the 1/2/5-minute options when
  `process.env.NODE_ENV === "development"`, the same dead-code-elimination pattern as
  `DevQuickSwitch` (§6.13 below), so a production `next build` never shows them even
  though the backend allowlist is a separate, server-side gate.
- **`GET /me/bids`**: the real data behind "Buying" and "Bids/Offers" — every
  auction the caller has bid on, their own max, and whether they're currently winning.
- **Frontend**: `lib/types.ts` is the one canonical `Listing` shape (mirrors the Go
  JSON exactly); `lib/api.ts` has the fetchers. Homepage, listing detail (including
  live bid placement via `BidBox`), Sell (`SellWizard`), Selling, Buying, and
  Bids/Offers are all real. Sold History and Buy History are real too (see
  `internal/auction.MySales`/`MyPurchases`). Messages is also real now — see §6.15;
  `lib/mock-account.ts` (the old `myMessages` placeholder) has been deleted.
- **Fixed-price "Buy It Now" is a real listing with no real purchase path behind it
  yet** — the button on the listing page is intentionally disabled ("coming soon"),
  not wired to fake success. Checkout/payment is separate, larger work, and is now
  additionally blocked on the wallet's legal review (§5.1, §7) before it can restart.
- **"You're the top bidder" is a real, per-listing indicator everywhere an auction
  card can render** (homepage, "More from this seller", the detail page's price box)
  — green, shows the bidder's own max ("winning up to $X"), and only while the
  auction hasn't ended. Backed by the same `GET /me/bids` data as the Buying page
  (`MyBid.status === "winning"`), fetched server-side and threaded down as
  `myBid`/`myBidsByListingId` props through `ListingSection` to `ListingCard`, and
  directly into the detail page's price box above `BidBox` — same
  server-fetched-initial-state pattern as the watch-heart fix above, for the same
  reason (no client-side auth race). Note this is a UI-level indicator, not a new
  backend concept: `highBidderId` was already public on every listing (CLAUDE.md
  §6.1's "only current price and high-bidder, never anyone's max" — bidder *identity*
  was always exposed, just not the max), so the only new piece is `/me/bids` being
  reused as a per-listing map instead of only a flat "Buying" list.
- **Sell flow is a 3-step wizard** (`SellWizard` → `sell-wizard/Step1Details`,
  `Step2Photos`, `Step3Price`), not a single form: describe the card, then guided
  photos, then price + list. State is lifted in `SellWizard` and passed down; nothing
  is submitted to `apps/api` until step 3's "List it."
- **Real photo storage, via Supabase Storage** — not Cloudflare R2/S3 as the tech
  stack table originally named, and not a fake upload UI. Reusing the already-
  provisioned Supabase project (no new external account, unlike everything else that's
  needed one) beat standing up R2 for this. `apps/api/migrations/0004_listing_photos`
  creates the `listing-photos` bucket (public read) plus RLS policies scoping
  upload/delete to the uploader's own folder (`{user_id}/...`) — enforced via
  `storage.foldername(name)[1] = auth.uid()`, verified end-to-end (own-folder upload
  allowed, cross-user and unauthenticated upload both blocked, public read confirmed
  byte-exact). **Gotcha found the hard way**: a public bucket's `public=true` bypasses
  RLS for the anonymous `/object/public/...` download endpoint, but authenticated
  management operations (delete included) still need an explicit SELECT policy — this
  needed a follow-up migration (`0005_listing_photos_select_policy`) after the first
  version silently broke deleting your own photo. Uploads happen entirely client-side
  via `@supabase/supabase-js` (`lib/storage.ts`) straight to Storage — no Go endpoint
  involved, same shape as Supabase Auth. A listing requires at least one photo
  (`ErrInvalidInput` otherwise) — enforced in `internal/listing.Create`, not just the
  wizard's UI.
- **Watchers are real** (`internal/watchlist`, `watchlist` table, `0006_watchlist`
  migration) — the "N Watchers" badge on a listing's detail page is a live
  `count(*)`, never a stored/fabricated number. `GET/POST/DELETE /listings/{id}/watch`
  are all authenticated; `listing.Listing.WatcherCount` is a subquery in the main
  (public) listing select, so anonymous visitors see the true count even before
  signing in. `WatchBadge` fetches the *viewer's own* watching state separately on
  mount, since the public listing endpoint can't know who's asking. "In Cart" was
  explicitly deferred (not built) — there's no real cart/checkout concept yet, and it
  doesn't map cleanly onto auction-format listings (you bid, you don't add to cart).
  Revisit once real cart/checkout exists rather than building cart infrastructure just
  to back a counter.
- **The heart on every `ListingCard` reflects real per-user watch state everywhere it
  renders** (homepage grids, listing detail's "More from this seller", Selling,
  Buying), not just the detail page's own `WatchBadge`. Backed by
  `GET /me/watchlist` (`internal/watchlist.MyWatchedListingIDs`), returning all
  listing IDs the caller is watching in one query. `lib/api.ts`'s `getMyWatchedIds`
  turns that into a `Set<string>`, fetched once per page render via the shared
  `lib/session.ts` `getCurrentSession()` helper and threaded down as
  `watchedIds`/`isLoggedIn` props through `ListingSection` to each `ListingCard`
  (`initialWatching={watchedIds.has(listing.id)}`). `ListingCard`'s heart button
  itself does a real `POST`/`DELETE /listings/{id}/watch` on click — it used to be a
  local `useState(false)` with no persistence at all, which is what prompted this
  fix. This is the same server-fetched-initial-state pattern as `WatchBadge`, applied
  consistently everywhere a card can appear, specifically because a per-component
  client-side auth check is a race condition (see `WatchBadge` history below) — always
  fetch watch state server-side alongside the session, never re-derive it client-side
  per card.
- **CORS `Access-Control-Allow-Methods` must list every verb the frontend actually
  calls** (`internal/platform/cors.go`) — it was originally `GET, POST, OPTIONS` and
  silently broke unwatching (`DELETE /listings/{id}/watch`) in real browsers, because
  the preflight rejected the method before the request handler ever ran. `curl`-based
  backend testing didn't catch this, since curl doesn't enforce CORS preflight at
  all — a working `curl -X DELETE` proves the endpoint works, not that the browser can
  reach it. Any new HTTP method added to a route needs this list updated too, and
  verification needs an actual browser (or a cookie/fetch-based check that goes
  through the frontend origin), not just curl against the API directly.
- **Dev-only "Quick Switch"** (`components/DevQuickSwitch.tsx`,
  `app/api/dev/switch-user`) — lets you sign in as one of three pre-seeded real test
  accounts (`DEV_ACCOUNT_*` in `.env.local`, gitignored) without the log-out/log-in
  dance, specifically so bidding/watching can be tested across distinct identities
  without spinning up new accounts each time. **This is not an auth bypass** —
  deliberately not built as one. It performs a real `signInWithPassword` server-side;
  the self-bid check and every other auth path work exactly as they do for a real
  user, because nothing about them is different. Gated on `NODE_ENV === "development"`
  in both the panel (dead-code-eliminated from production builds) and the route
  handler itself (belt-and-suspenders — refuses to run even if somehow reachable).
  Verified the elimination is real, not just conditionally-hidden: ran an actual
  `next build` + `next start` with `NODE_ENV=production` and confirmed neither the
  panel HTML nor its chunk are present in the response, and `/api/dev/switch-user`
  404s — a Server Component conditionally rendering a client component only *skips
  the RSC reference*, so this was worth checking rather than assuming.
  **The panel shows which account is currently active** (`app/layout.tsx` passes
  `currentEmail` from the real verified session, plus the three `DEV_ACCOUNT_*_EMAIL`
  values, down as props) — the active button is highlighted green and the panel reads
  "Signed in as {label}", so you don't have to hover the account menu top-right to
  check. Same server-fetched-initial-state pattern as everywhere else in this file:
  the highlight is derived from the real session on every server render (and updates
  automatically after `switchTo`'s `router.refresh()`), never a client-side guess.

### 6.14 Category filtering, search, and the left filter sidebar

The `CategoryNav` game bubbles (under the header, e.g. "Pokémon (3)") went from
decorative buttons with a hardcoded fake "Supplies" category and no click handler to
a real filter, all URL-driven — no client-side filter state anywhere.

- **Filtering is a `?game=` query param on `/`, not client state.** `CategoryNav` is
  plain `<Link href="/?game=...">` elements (no `"use client"` needed — the active-pill
  highlight is just a server-side string comparison against the `activeGame` prop).
  Clicking a bubble from *any* page navigates home with that filter applied. The
  homepage (`app/page.tsx`) reads `searchParams.game` (Next 16's async `searchParams`
  prop, same `Promise<>`-and-`await` shape as dynamic route `params`) and passes it
  straight to `getActiveListings(undefined, game)`, which hits `GET /listings?game=...`
  — filtering happens in Postgres (`internal/listing.ListActive`'s new `game` param),
  not by fetching everything and filtering in JS. Removed the fake "Supplies" bubble
  in the process — it didn't correspond to a real, filterable `catalog.Game`, and
  leaving one dead bubble next to five real ones was the same "looks real, isn't"
  problem as the fabricated wallet balance (§5.1) and the old fake Watchlist counts.
- **Search is real too, and needed the same treatment** — the header's search box
  used to be a `<form>` with no `action`, no `name` on its `<input>`, going nowhere.
  Now both the desktop and mobile search forms are plain `action="/" method="GET"`
  forms with `name="q"` — a real HTML GET submission, no client JS or `"use client"`
  required, same philosophy as the game-bubble links. `?q=` hits the same
  `GET /listings` endpoint (`ListActive`'s new `search` param, a plain `ilike
  '%...%'` match against title — v1 per CLAUDE.md §6.7, not Postgres full-text; that's
  still the documented upgrade path if title-substring matching stops being enough).
  Game and search combine (both become `AND` conditions in the same query) rather
  than one resetting the other: `CategoryNav`'s bubble links carry the current `?q=`
  forward, and both search forms carry a hidden `game` input forward, so "search
  'Charizard', then narrow to Pokémon" behaves like a refinement.
- **The Hero landing section only shows on the true, unfiltered homepage** — explicit
  product decision: the moment either `?game=` or `?q=` is present, `app/page.tsx`
  hides `<Hero />` entirely (`isFiltered = Boolean(game) || Boolean(q)`), so a
  filtered/searched view reads as a results page, not a landing page with results
  bolted on underneath. "All Categories" is the one link that resets both params at
  once (`href="/"`), which is what makes it the way back to the landing state, not
  just another filter option. Hero's headline also changed to "The marketplace built
  for the people." (was "...for serious collectors.").
- **The counts next to each bubble are real, site-wide totals** — `GET
  /listings/counts` (`internal/listing.CountsByGame`) does a single grouped
  `count(*)` over all active listings and zero-fills every game from
  `catalog.AllGames`, so the frontend never has to guess whether a missing key means
  zero or means the fetch hasn't happened yet. Deliberately *not* scoped to the
  current filter — clicking into "Pokémon" doesn't make the other bubbles' counts
  disappear or go stale, since they reflect the whole site regardless of what's
  currently selected. `Header` (already an async Server Component, per §6.12) fetches
  this once and passes it down to `CategoryNav` alongside `activeGame`; only
  `app/page.tsx` actually supplies `activeGame` today, since it's the only page with a
  filter — every other `<Header />` call site just omits it, leaving "All Categories"
  as the shown-active state everywhere else.
- **The Filters sidebar (`components/FilterSidebar.tsx`) is a persistent left column
  on the homepage**, not a modal/overlay — `app/page.tsx` now lays out
  `FilterSidebar` + the listing sections as a flex row inside one padded container.
  It reads the same `activeGame`/`activeQuery` the bubbles and search box set and
  renders each as its own removable chip (`Pokémon ×`, `"charizard" ×`) — there's no
  separate filter state to keep in sync between the bubbles/search and the sidebar,
  they're all just views of the same URL params. Clearing one chip preserves the
  other (`clearGameHref`/`clearQueryHref` each carry the remaining param forward), so
  dropping the game filter after searching doesn't also clear the search. Built to
  grow: more filter types (condition, price range) are meant to land here as
  additional chips, not as a separate UI, whenever those become real.
- **`ListingSection` no longer owns horizontal page padding** — it used to hardcode
  `px-10 sm:px-12 lg:px-14` itself, which worked when it was always the outermost
  horizontally-padded element, but broke down once the homepage needed a sidebar
  column next to it (nesting the old padding inside a new padded row would've
  double-padded the grid). Padding is now the caller's responsibility:
  `app/page.tsx`'s flex row supplies it once for both the sidebar and content column,
  and `app/listing/[id]/page.tsx`'s "More from this seller" section (the only other
  place `ListingSection` renders) wraps it in its own `px-10 sm:px-12 lg:px-14` div to
  make up for the padding it used to get for free. If a third place ever renders
  `ListingSection`, it needs the same explicit wrapper — this isn't optional.
- **Empty states are filter-aware.** "No listings yet — be the first to create one"
  only shows when there's genuinely nothing on the whole site; filtering into a game
  with zero active listings shows "No {game} listings right now" with a "Clear
  filter" link instead — conflating the two would read as the marketplace being
  empty when it's actually just that one filtered slice.

### 6.15 Buyer/seller messaging

Not an eBay-specific mechanic so much as standard marketplace table stakes (My eBay's
own Messages inbox is the closest analogue) — this replaced `lib/mock-account.ts`'s
`myMessages`, the last still-mock account surface noted in §6.13/§8.

- **One thread per unordered pair of users, not per listing.** `internal/message`
  (`migrations/0028_messages`) stores `message_threads` with `participant_one <
  participant_two` enforced by a check constraint plus a unique index on the pair —
  two people only ever have one running conversation with each other, the way iMessage
  or Gmail don't fork a new thread per topic. `listing_id` is just the context a thread
  happened to start from (shown as "About: <title>" in the thread header), not part of
  a thread's identity — messaging the same seller again from a different listing lands
  in the same conversation. `POST /me/messages` (`StartThreadWithMessage`) finds-or-
  creates the thread and sends the first message atomically, so a race between two
  concurrent "message this seller" clicks can never create two threads for the same
  pair (the unique index is what actually enforces this, not just the find-then-insert
  logic in Go).
- **Read state is per-participant-per-thread, not per-message.** `message_thread_reads`
  (`thread_id, user_id, last_read_at`) means marking a whole conversation read is one
  upsert, not an `UPDATE` over every row in it — same "derive, don't flip a flag per
  row" shape as `notification.MarkAllRead`. **Opening a thread (`GET
  /me/messages/{id}`) marks it read as a side effect** — there's no separate mark-read
  click the way the notification bell has one; viewing a conversation IS reading it,
  matching Gmail/iMessage. The unread badge counts unread *conversations*, not raw
  message counts, for the same reason a Gmail unread badge doesn't count individual
  emails within a thread.
- **The unread badge appears in two places, both server-fetched.** `Header` fetches
  `GET /me/messages` alongside notifications/listing counts and passes
  `unreadMessageCount` into `AccountMenu` (a numbered badge next to "Messages" in the
  dropdown, plus a small dot on the avatar trigger itself); `app/account/layout.tsx`
  fetches it again and passes it into `AccountTabs` (the "Messages 3" subnav badge
  visible while browsing anywhere under `/account`). Same "no client-only initial
  state" reasoning as `NotificationBell`'s own badge — both are real numbers on first
  paint, not a flash of zero.
- **The inbox itself (`/account/messages`) is a two-pane client component
  (`MessagesApp`), server-fetched for its initial state then kept current by
  polling** — there's no websocket infra in this repo, so polling is the real-time
  stand-in, same tradeoff as `NotificationBell`. The thread list polls every 15s
  (matching the bell); an *open* thread polls faster (4s) since that's the pane where
  "feels live" actually matters. Selecting a thread updates the URL
  (`?thread=<id>`) via `router.replace` so a conversation is deep-linkable without a
  full page nav. **The two-pane box fills whatever vertical space is left in
  `AccountLayout`'s `flex-1 <main>`** (`h-full`/`flex-1 min-h-0` all the way down from
  `account/messages/page.tsx` through `MessagesApp`), not a `calc(100vh-<magic
  number>)` — a hardcoded constant drifted out of sync with the actual header/tabs
  chrome above it during development (the composer ended up pushed below the
  viewport, forcing the whole page to scroll instead of just the message pane), and
  flex-fill doesn't have that failure mode since it never has to know the chrome's
  height.
- **Entry points, not a cold "start a new message" composer.** There's no user
  directory/search feature in this codebase to message an arbitrary stranger, and
  building one wasn't in scope — messaging starts from somewhere a seller is already
  shown: `MessageSellerButton` (an inline expanding form, same toggle shape as
  `ReviewForm`) on the listing detail page's `SellerCard` (only when the viewer is
  logged in and isn't the listing's own seller) and on the seller profile page's
  header. Both call `startMessageThread` and land the buyer straight in the real
  conversation it created at `/account/messages?thread=<id>`.

### 6.16 Sell wizard card autofill (TCG Haven catalog integration)

Not an eBay mechanic — a cross-app data-sharing decision. **TCG Haven** (a separate app on
the same machine/author) already maintains a scraped, admin-curated, multi-game card database
in its own Firestore project (`tcghaven-85a34`), covering Pokémon, Disney Lorcana, and
Riftbound — see that project's own "Admin Catalog" doc for the full read/write/caching design.
Rather than re-scrape/re-curate the same data a second time, `internal/cardcatalog`
**reads that catalog directly, read-only**, to power a "search for your card" box in the Sell
wizard's Step 1 that autofills Set/Card Number/Rarity.

- **Go API → TCG Haven's Firestore directly, server-side only** — chosen over the two
  alternatives considered (browser talking to TCG Haven's Firestore directly with the Firebase
  JS SDK; or calling TCG Haven's own Next.js `/api/cards/search` over HTTP). The browser-SDK
  option would put a second app's Firebase config in `apps/web`'s bundle, breaking the one rule
  this repo has been consistent about — the browser only ever holds Supabase config, every
  other third-party credential lives server-side in Go (§6.12). The HTTP-to-TCG-Haven's-app
  option would make Sell wizard autofill depend on that app's Next.js process being up, instead
  of depending on Firestore itself (managed, always-on). Neither requires TCG Haven's own app
  to be running at all — Firestore is the actual shared resource.
- **Auth: a dedicated, read-only service account** (`roles/datastore.viewer`), never TCG
  Haven's own write-capable "sync" account. Key file path is `CARD_CATALOG_CREDENTIALS_FILE`
  (gitignored, see `.gitignore`'s `apps/api/secrets/` entry — never commit it).
  `CARD_CATALOG_PROJECT_ID` is TCG Haven's project ID, not secret (it's a `NEXT_PUBLIC_*` value
  in that app's own `.env.local`). Both env vars empty is a supported, graceful-degradation
  state — same pattern as `SUPABASE_URL`/`STRIPE_SECRET_KEY`: `GET /catalog/search` just isn't
  registered, and the Sell wizard's fields stay hand-typed.
- **Trust-boundary caveat worth remembering**: Firestore IAM roles aren't collection-scoped —
  the read-only service account can technically read *any* collection in TCG Haven's project,
  including its per-user inventory data, not just `catalog/*`. Firestore Security Rules (which
  scope by collection) only gate client-SDK/end-user reads, not a service account using the
  Admin SDK. The actual boundary is `internal/cardcatalog`'s own code, which only ever queries
  the fixed `catalog_snapshot`/`catalog`/`catalog_meta` collection names, never anything
  parameterized from a request — mirrors how the Go API's own Postgres `postgres` role bypasses
  Supabase RLS by design (§6.12), same "push the trust into our own code, not the remote store"
  shape.
- **Caching is a simpler cousin of TCG Haven's own design**, not a port of its exact
  delta-sync mechanism. `internal/cardcatalog` reads TCG Haven's pre-sharded
  `catalog_snapshot/{game}/chunks/*` (same chunks TCG Haven's own server reads on cold start)
  and holds them in memory per game, doing a full re-read after a 2-minute TTL rather than
  TCG Haven's finer-grained `updatedAt`-delta pull — this is a secondary, read-only consumer
  where a full snapshot re-read is a handful of document reads either way, so the extra
  complexity of parsing TCG Haven's serialized Firestore Timestamps for delta comparison
  wasn't worth carrying over.
- **Search ranking is a direct Go port of TCG Haven's `scoreMatch`/`parseSearchQuery`**
  (`lib/api/catalog.ts` there → `internal/cardcatalog/search.go` here) — word-start prefix
  matching only, never mid-word substring matching, same scoring weights (exact token +30,
  prefix +15, tag hit +20, first-word bonus +10). Kept identical on purpose so results feel the
  same as TCG Haven's own search, not a divergent second implementation.
- **Only 3 of AuctionHous's 6 games have any catalog to draw from** — `games.go`'s `gameSlug`
  maps `"Pokémon"`/`"Disney Lorcana"`/`"Riftbound"` to TCG Haven's slugs; MTG, Yu-Gi-Oh!, and
  Sports Cards resolve to no suggestions (`GET /catalog/search` returns `[]`), not an error —
  the frontend's `CardSearch` component (`Step1Details.tsx`) hides the search box entirely for
  unsupported games rather than showing an empty, always-failing search field.
- **Autofill is text fields only — never the card image.** Selecting a search result fills
  `title`/`setName`/`cardNumber`/`rarity`, all still editable afterward. It deliberately does
  not touch Step 2's photos: a listing's photos are the seller's own proof of the physical
  card's actual condition (§6.13's photo requirement exists specifically to prevent
  misrepresentation), so autofilling a stock catalog image would undermine the exact thing that
  requirement is for.

### 6.17 Claim ticket numbers, the animated Support claim picker, and the Workers admin dashboard

Not eBay-derived so much as filling real gaps under §6.5's dispute engine
(`internal/dispute`) — which was already fully real before this section existed: state
machine, auto-adjudication, Stripe refund execution, negotiation thread, all live. What
was still missing was a human-facing ticket number, a way to *reach* the claim flow
without already being on the right order page, and — the bigger gap — any way at all
for a hired reviewer to see or decide a `human_review` claim without calling the API
directly with curl.

- **Ticket numbers**: `claims.ticket_no` (migration `0033_claim_ticket_numbers`,
  `bigserial`), formatted at read time as `CLM-000123`
  (`internal/dispute.formatTicketNumber`) rather than stored pre-formatted, so the
  display format can change without a migration. Surfaced as `Claim.TicketNumber` on
  every claim API response, shown as a badge everywhere a claim renders
  (`ClaimPanel.tsx`'s thread header, the admin queue, the decide screen).
- **`/support/claim`** replaced its original "go find your order in Buy History/Sold
  History" links with an animated, in-place picker (`components/ClaimStart.tsx`): role
  choice ("I'm a Buyer"/"I'm a Seller") → a shortened list of the caller's matching
  recent orders (real `GET /me/orders` data, filtered client-side, capped at 6 with a
  "view all" escape hatch) → the real claim sheet, reusing `ClaimPanel` rather than a
  second claim form. Since this picker can land on *any* order someone picks (not just
  one already known to be claimable), `ClaimPanel` gained an optional
  `notEligibleFallback` prop — an honest explanation ("only the buyer can open a
  claim," "this order isn't in its claim window") instead of the panel silently
  rendering nothing, which is fine on the order-status page (only ever shown when
  eligible) but wasn't fine here.
- **The Workers admin dashboard** (`app/admin/layout.tsx`) is the first piece of what's
  meant to grow into a full internal ops side, deliberately *not* another page wearing
  the storefront's `<Header />`/`<Footer />` — no search bar, no category nav, no Sell
  button. A dark sidebar (`AuctionHous` / `Workers`, nav links with active-state
  highlighting via `components/AdminSidebarNav.tsx`, a "back to site" link) wraps every
  `/admin/*` route and owns the login gate once instead of repeating it per page. Same
  `ADMIN_EMAILS` allowlist gate as everything else admin-only in this repo (§6.4-
  adjacent `internal/user.IsAdmin`) — no real role system yet.
  - **`/admin/claims`** — a queue over claims (`internal/dispute.ListForAdmin`, a
    denormalized join mirroring `order.Summary`'s "no N+1 per row" shape), with tabs
    for "Needs Review" (`human_review`), "Appealed", and "All" (`?state=all` is its
    own sentinel, distinct from the param being absent, so the All tab doesn't just
    re-show the default filter).
  - **`/admin/claims/{id}`** — the decide screen: order/listing context, the full
    negotiation thread (read-only — an admin is neither the claim's buyer nor seller,
    so none of `ClaimPanel`'s participant-gated mutation actions apply), and a decide
    form (resolution/liable party/refund amount) calling the `decide`/`decide-appeal`
    endpoints that already existed — this page adds a UI, not new business logic.
- **The `support@` email notification** (`internal/mail`, Resend) fires exactly once —
  when a claim reaches `human_review` — not on every claim opened, since most resolve
  via negotiation or auto-adjudication without a human ever touching them. Also fires
  from the real path that lands a claim in `human_review` in production
  (`cmd/worker/claim_timer.go`'s 48-hour auto-escalation loop), not just the manual
  "Escalate this claim" button. Full setup, DNS records, and how it was verified
  end-to-end against a real inbox: `docs/Resend.md`.

---

## 7. Compliance flags (non-engineering, but architecture-shaping)

- **Money transmitter licensing risk — wallet functionality removed as of now over
  this, not just flagged for later.** A platform that holds customer funds in a wallet
  *and* in escrow, outside of a single card-present transaction, is exactly the shape
  of business that can trigger US state money-transmitter licensing requirements.
  Rather than ship wallet deposits ahead of legal review, the wallet has been pulled
  out of the codebase entirely (§5.1): `wallet_ledger_entries` table dropped
  (`migrations/0007_remove_wallet`), `internal/wallet` package deleted, the header's
  wallet-balance nav link removed. The mitigating pattern for whenever this is
  rebuilt (and why Stripe Connect is still the intended target) is to keep funds
  inside **Stripe's balance** end-to-end — deposit → wallet balance → escrow hold →
  payout should all be modeled as Stripe Connect balance transactions/transfers, not as
  money that ever sits in the platform's own bank account. Stripe Connect reduces but
  does not automatically eliminate this exposure depending on how the wallet/escrow
  flow is structured — actual legal review is still required before rebuilding this,
  not assumed solved just because Stripe is the planned vendor.
- **PCI scope.** Raw card numbers must never touch our backend — use Stripe's
  client-side tokenization (Elements/Payment Element) exclusively for the wallet
  deposit flow.

---

## 8. Phasing

**v1 (must-have, matches design doc as written):**
Account creation (done — see §6.12). Listing creation and auction bidding (done — real
`listings`/`auctions`/`bids` tables, `internal/listing` + `internal/auction`, real Sell
page, homepage/listing-detail/Buying/Selling/Bids-Offers all on live data, no mock
listings left in the frontend — see §6.13). Category filtering + a basic real search
box are also done (§6.14) — full relevance/price sorting and full-text search are
still the v1 gap, per §6.7. Buyer/seller messaging is done (§6.15). The dispute
resolution flow is done (§6.5, §6.17) — real state machine, auto-adjudication, Stripe
refunds, claim ticket numbers, and a Workers-side admin queue/decide UI gated by
`ADMIN_EMAILS`, plus a live `support@` email notification via Resend (`docs/Resend.md`)
when a claim needs a human. Still to build: fixed-price checkout (the
"Buy It Now" button is a real listing but a disabled placeholder — no order/payment
flow behind it yet), cart batching for sub-$20 singles, escrow state machine, seller
Tier 1–3 (§6.4's tier ladder itself is real — see `internal/seller` — this refers to
the rest of the eBay-style seller-standards machinery), feedback + detailed ratings,
cert-number grading verification, domestic shipping integration. **Wallet + ledger
is explicitly removed from v1 scope, not just unbuilt** — see §5.1/§7; it's blocked on
legal review, not on engineering bandwidth, so don't schedule it as ordinary backlog
work.

**v2+ (deliberately deferred, do not build prematurely):**
Physical authentication/inspection partnership, Ship-to-Vault storage, Cassini-style
learned ranking, Promoted Listings/ads, bulk seller API polish, international shipping.

---

## 9. Open questions (yours to decide, not assumed here)

1. **Appeal window length** for dispute decisions (§6.5) — eBay uses 30 days; is 7–10
   days the right call given our margin, or is that too aggressive for buyer trust?
2. **Physical grading/authentication partner** for the v2 Authenticity-Guarantee-style
   feature — PSA (like eBay), BGS, CGC, or a multi-partner approach?
3. **Launch geography** — domestic (US) only at launch, confirmed? Design doc doesn't
   mention international.
4. **Legal owner for the money-transmitter review** (§7) — who signs off before wallet
   deposits go live in production?
5. ~~**Mobile** — native app planned, or web-responsive only for v1?~~ **Decided:**
   web-responsive only for v1; a React Native (Expo) iOS app is a v2 addition once the
   web marketplace has real listings, sharing the generated TS client from
   `packages/shared-contracts` rather than a full separate rewrite. See §2 repo layout.
6. ~~**Database + auth hosting** — build vs. buy, and which vendor?~~ **Decided:**
   Supabase (Postgres + Auth + storage, bundled) — see `docs/infra-cost-analysis.html`
   and §6.12. You still need to actually create the Supabase project (an account-signup
   step only you can do) — see the setup note in §10.

---

## 10. Engineering conventions

**One-time setup (do this before anything auth-related will actually run):**
1. Create a free project at supabase.com — this is an account-signup step only a human
   can do, no CLI/API shortcut for it.
2. Project Settings → API: copy the Project URL and publishable key into
   `apps/web/.env.local` (copy from `apps/web/.env.example`).
3. Project Settings → Database → Connection string → **Session pooler** (not Direct
   connection, not Transaction pooler — see the troubleshooting note below for why):
   copy into `apps/api/.env` as `DATABASE_URL` (copy from `apps/api/.env.example`), and
   set `SUPABASE_URL` there too (same value as the frontend's Project URL).
4. `cd apps/api && go run ./cmd/migrate` — applies everything in `apps/api/migrations/`
   in order, tracked in a `schema_migrations` table so re-running is a no-op.
5. **Google sign-in** (optional, only needed for the "Continue with Google" button to
   work): in [Google Cloud Console](https://console.cloud.google.com/auth/clients/create),
   create an OAuth Client ID (type: Web application) — Authorized JavaScript origins:
   your app URL (`http://localhost:4000` for dev); Authorized redirect URIs:
   `https://<project-ref>.supabase.co/auth/v1/callback` (Supabase's fixed callback, not
   ours). Then in the Supabase dashboard, Authentication → Providers → Google: paste
   the Client ID + Client Secret from Google. Finally, Authentication → URL
   Configuration → Redirect URLs: add `http://localhost:4000/auth/callback` (and later
   the production equivalent) — `signInWithOAuth`'s `redirectTo` is rejected if it isn't
   on this allow list.

Local dev currently targets that real (free-tier) Supabase project directly — there's
no Docker in this environment, so `infra/docker-compose.yml` (Postgres/Redis/MinIO) is
unused for now. It's still there for later: self-hosting, or a dev machine that does
have Docker and would rather run Redis locally than use a free Upstash instance.

**Troubleshooting the one-time setup** (both cost real time getting this project working):
- **"no route to host" / connection timeout on the direct connection
  (`db.<ref>.supabase.co:5432`):** that hostname is IPv6-only, and plenty of
  networks (this one included) can't route to it even when they have IPv6
  connectivity in general — it's a gap in the network's IPv6 peering, not
  something fixable in this repo. Use the **Session pooler** connection string
  instead (`aws-0-<region>.pooler.supabase.com:5432`, username
  `postgres.<project-ref>`) — it's IPv4-reachable and, since it's a pooler,
  the better default for an app backend anyway.
- **Transaction pooler (port 6543) + pgx "prepared statement does not exist"
  errors:** PgBouncer's transaction mode can route each query to a different
  backend connection, so a statement pgx cached as prepared on one backend may
  not exist on the next. `internal/platform/db.go`'s `NewPgxPool` sets
  `DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol` to route around
  this — always connect through it (never raw `pgxpool.New`/`pgx.Connect`) so
  new code doesn't reintroduce the problem. Session pooler (port 5432) doesn't
  have this failure mode at all, which is another reason to prefer it.
- **"password authentication failed" right after setting/resetting the DB
  password:** can take roughly a minute to propagate to the pooler. Confirm
  the password is actually the *database* password (Project Settings →
  Database) and not your Supabase account login password — those are two
  different credentials — then retry after a short wait before assuming the
  password itself is wrong.

**Backend (`apps/api`, Go 1.26, module `auctionhous-tcg/api`):**
- Run: `go run ./cmd/api` (loads `.env` via `godotenv`; health check at
  `:8080/healthz`; `/me` only registers once `SUPABASE_URL` is set)
- Build/vet everything: `go build ./...` && `go vet ./...`
- Migrations live in `apps/api/migrations/` as `NNNN_name.{up,down}.sql`
  (golang-migrate naming convention). `0002_supabase_auth_sync` expects to run against
  a Supabase-provisioned Postgres (it references the `auth` schema) — it will fail
  against a bare Postgres instance. No migration runner is wired into `cmd/migrate`
  yet — that's the next real piece of backend work, not a solved problem.
- Money is always `pkg/money.Cents` (int64), never `float64` — see §5.1.
- Auth verification lives in `internal/platform/auth.go` — add `verifier.RequireAuth`
  around any handler that needs to know who's calling, and read the user id via
  `platform.UserIDFromContext`.

**Frontend (`apps/web`, Next.js, TypeScript, Tailwind, App Router):**
- Run: `npm run dev`
- Build: `npm run build`
- Routes so far: `/` (homepage), `/listing/[id]`, `/signup`, `/login`.
- Never import `lib/supabase/server.ts` (or anything that pulls in `next/headers`)
  from a `"use client"` file — split the interactive part into its own client
  component (see `SignUpForm`/`LoginForm` next to `app/signup`/`app/login`'s server
  page shells) the way `Header` needed splitting from `SignOutButton`.
- The API client under `apps/web/lib` should be generated from
  `packages/shared-contracts/openapi.yaml`, not hand-written — see that
  package's README. (This is separate from the Supabase clients in
  `lib/supabase/`, which talk to Supabase directly for auth only.)

**Contracts:** any new API endpoint gets added to `packages/shared-contracts/openapi.yaml`
first; Go and TypeScript types are generated from it, not duplicated by hand.

**Commits:** no enforced convention yet — establish one (e.g. Conventional Commits) in
the first PR that adds a second contributor, not preemptively for a solo scaffold.
