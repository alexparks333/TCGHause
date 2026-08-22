-- Separate-charges-and-transfers rework (docs/Legal_MoneyTransitter.md): the
-- buyer's charge now lands on the platform's own Stripe balance, not a
-- seller's connected account, so money movement to the seller happens as an
-- explicit Transfer at release time, not automatically at charge time.
-- refunded_cents tracks how much of an order's seller_net_cents has already
-- been carved out by a partial refund, so the eventual release-time Transfer
-- amount (seller_net_cents - refunded_cents) is never more than what's
-- actually left after any dispute settlement. stripe_transfer_id records the
-- resulting Transfer once it's made — orders.stripe_charge_id (already
-- existed, previously unused) is populated at capture time from the same
-- platform-side charge.
alter table orders add column refunded_cents bigint not null default 0;
alter table orders add column stripe_transfer_id text;
