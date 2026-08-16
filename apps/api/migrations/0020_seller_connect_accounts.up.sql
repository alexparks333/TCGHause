-- Stripe Connect Express account state per seller (design doc v2 §5.1/§7).
-- Mirrors the users.stripe_customer_id pattern from 0018_stripe_customers
-- exactly — nullable, lazily populated, unique partial index — but this is
-- a deliberately distinct identity from stripe_customer_id: a Connect
-- account id is the seller's merchant identity (who gets paid, whose
-- balance a direct charge lands in), while a Customer id is a buyer's
-- saved-card identity. The same person can be both a buyer and a seller,
-- so these must never be conflated into one column.
alter table users add column stripe_account_id text;
alter table users add column connect_charges_enabled boolean not null default false;
alter table users add column connect_payouts_enabled boolean not null default false;
alter table users add column connect_details_submitted boolean not null default false;
alter table users add column connect_onboarded_at timestamptz;

-- 'weekly' batches payout API calls to amortize Stripe's flat 0.25% + $0.25
-- per-payout cost across ~20 orders (design doc v2 §6.2); 'per_order' and
-- 'instant' are seller opt-ins that bear the extra cost themselves.
alter table users add column payout_cadence text not null default 'weekly'
    check (payout_cadence in ('weekly', 'per_order', 'instant'));

create unique index users_stripe_account_id_idx on users (stripe_account_id)
    where stripe_account_id is not null;
