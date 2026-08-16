# Tasks / Follow-ups

Running list of things to come back to. Not a replacement for `CLAUDE.md`
or `docs/PercentageModel.md` — this is just "don't forget to do X."

## Stripe

- [x] **Automatic payout sweep removed, 2026-08-10 — payouts are now
  always seller-initiated.** `cmd/worker/payout_timer.go` used to run a
  5-minute-interval loop that auto-paid-out every RELEASED order via
  Stripe's Standard speed — which quietly broke the entire premise of the
  Instant-payout upsell (§6.3): if funds already got swept out
  automatically the moment they were released, a seller could never
  actually choose to pay 2% for speed, because the free path had already
  fired first. Deleted that file and its wiring in `cmd/worker/main.go`.
  Payouts are now ONLY triggered by a direct seller click on the Withdraw
  page (`/account/withdraw`, linked from the account dropdown under
  "Selling") — "Standard Transfer" (free, ~1-2 business days,
  `internal/payout.TriggerStandardPayout`, new `kind: 'standard'`,
  migration `0027_payout_kind_standard`) or "Instant Transfer" (2% fee,
  ~30 minutes, existing `TriggerInstantPayout`). The Withdraw page itself
  is new too: wallet balance (`GET /me/payout/summary`) showing what's
  actually available vs. still on hold (unshipped/in-transit/claim-window
  orders), plus payout history — Account Settings' old blind "Get paid
  now" button (no balance visibility at all) was removed in favor of it.

- [ ] **API version mismatch (real bug, currently worked around).** This
  Stripe account defaults to API version `2026-07-29.dahlia`; the pinned
  `stripe-go v82.5.1` SDK expects `2025-08-27.basil`. Webhook signature
  verification currently bypasses this via `IgnoreAPIVersionMismatch: true`
  (`internal/webhook/webhook.go`) — safe for the specific fields this app
  reads today (all stable, long-standing field names), but not a permanent
  fix. Proper fix is one of:
  - Upgrade `stripe-go` to a version that supports the account's API
    version (check what's current), or
  - Pin the *webhook endpoint's* API version to `2025-08-27.basil`
    explicitly (only really possible with a real dashboard-registered
    endpoint, not the CLI's ad-hoc `stripe listen` session).

- [ ] **Production webhook setup.** Right now webhooks only work locally
  via `stripe listen` (a temporary relay, see below). Before going live,
  register a real webhook endpoint in the Stripe Dashboard pointing at the
  deployed API's `/webhooks/stripe`, with **"Listen to events on connected
  accounts" turned on** — without that toggle, `account.updated`/
  `payout.paid`/`payout.failed` (all Connect events) silently never arrive
  even though the endpoint itself works fine for platform-level events.

- [ ] **Accounts v1 vs v2.** Currently creating Connect accounts via the
  older v1 API (`stripe.Account.Create`, `type: express`), with "Accounts
  v1 support" manually enabled in the dashboard
  (`dashboard.stripe.com/settings/features/feat_accounts_v1_support`).
  Stripe's stated direction is v2 Core Accounts
  (`POST /v2/core/accounts`) for new integrations — `stripe-go v82.5.1`
  doesn't support v2 at all, so this needs an SDK upgrade first, then a
  real rework of `internal/payment.CreateExpressAccount` /
  `internal/seller/connect.go` around v2's different account model
  (configurations + capabilities, not `type: express`). Not urgent while
  v1 support stays enabled, but v1 could eventually be deprecated further.

- [ ] **`stripe listen` is a local-dev-only crutch, not a real solution.**
  It has to be running for webhook delivery to work at all locally, and it
  dies if the terminal/session that started it closes. Tried building an
  automated watchdog to detect and restart it — proved unreliable in this
  sandboxed tool environment (background processes spawned from inside a
  background script don't reliably survive between tool calls). If
  webhook syncing seems to stop working during testing, check with
  `pgrep -fl "stripe listen"` and restart manually if needed. This whole
  problem goes away once deployed (see "Production webhook setup" above).

- [x] **MCC (merchant category code) not set** — done. `business_profile.mcc`
  is now set to `5945` ("Hobby, Toy, and Game Shops" — the standard
  card-network code for trading card games/collectibles) on every seller
  account at creation (`internal/payment.CreateExpressAccount`), alongside
  a platform-wide `settings.payments.statement_descriptor` ("AUCTIONHOUS
  TCG"). Together these skip the "What's your industry?" and "make up a
  statement descriptor" onboarding questions entirely — same pattern as
  the earlier website/business-type prefills. Also required for the
  `card_payments` capability to ever go `active` — was the actual root
  cause of a real bug where checkout-intents could be created fine but
  confirming payment failed with "You cannot create a charge on a
  connected account without the `card_payments` capability enabled."

- [ ] **The "Business type: Individual" confirmation screen in onboarding
  is deliberately NOT removable, decided 2026-08-10.** Even though
  `BusinessType: "individual"` is pre-filled at account creation, Stripe's
  hosted onboarding still shows one confirm-and-continue screen for it —
  by design: Stripe requires the account holder to confirm pre-filled
  info before accepting the Connect services agreement, on every
  onboarding surface (hosted or embedded), because this is a real KYC
  classification, not a UI default. It exists at all because this app
  uses **direct charges** — each seller is their own merchant of record,
  which is what keeps the platform itself from ever touching customer
  money (CLAUDE.md §5.1/§7's whole rationale for avoiding money-
  transmitter licensing exposure). Platforms where sellers never see this
  (eBay, Etsy) are almost certainly on a model where the PLATFORM is
  merchant of record for every charge instead, with sellers as pure
  payout recipients — the destination/recipient-charges model this repo
  explicitly chose against. Considered and explicitly declined:
  (1) migrating to Stripe's embedded onboarding components
  (`@stripe/connect-js` + Account Sessions + `collectionOptions`) to try
  to suppress the screen — Stripe's own docs suggest the confirmation may
  be mandatory regardless of hosted vs. embedded, so this isn't even
  guaranteed to work, and (2) switching to destination charges — reopens
  the money-transmitter question, a legal call, not a UI one. Don't
  attempt either without a fresh, explicit go-ahead — this is one
  pre-filled dropdown and one click of Continue, about as light as this
  gets while staying compliant.

- [ ] **Editing a Connect account's own fields after onboarding starts can
  lock the platform out.** Hit `oauth_not_supported` trying to update
  `business_type` on an account via the platform API after the seller had
  already started their own onboarding session — Stripe restricts some
  fields from platform-side edits once the connected account holder has
  touched them. Worth knowing if a "fix a seller's account details for
  them" admin tool is ever built.

- [ ] **ACH balance-check-before-confirm (design doc v2 §4.1) not
  implemented.** `internal/payment.CreateAchIntent`'s doc comment flags
  this — a buyer can currently confirm an ACH payment without an upfront
  Financial Connections balance check, so insufficient funds surfaces as a
  real bank return days later instead of an instant rejection.

- [ ] **Self-dealing detection (design doc v2 §3.6) not built.** Flagged
  as a stretch item, not core v1 scope — no fraud-signal infrastructure
  (device fingerprinting, address/payment-instrument clustering) exists
  yet.

- [ ] **Legal sign-off still required before flipping to live keys** —
  agent-of-payee language in the seller agreement, and a real review of
  the Stripe Connect agreement's hold-period/dispute-liability terms
  against what this app assumes (design doc v2 §12.2/§12.3). Everything
  built so far is test-mode only, deliberately.
