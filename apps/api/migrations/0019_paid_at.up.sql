-- Buy History was showing every purchase as "Awaiting payment" even after
-- a real Stripe test-mode charge actually captured — because nothing
-- anywhere recorded that a payment had genuinely happened. paid_at is that
-- fact: set only when internal/auction.HandleBuyNow's Stripe capture call
-- (internal/payment.Client.Capture) actually succeeds, right after the
-- atomic purchase itself already committed. Still null for:
--   - any purchase made through the no-Stripe mock-payment path (nothing
--     was ever charged, so "awaiting payment" remains literally true), and
--   - a plain auction win via bidding (no checkout/payment step exists for
--     that path at all yet — CLAUDE.md's Buy It Now is Stripe-integrated,
--     regular bidding still isn't).
alter table listings add column paid_at timestamptz;
alter table auctions add column paid_at timestamptz;
