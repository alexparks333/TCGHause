-- A real cardholder chargeback (charge.dispute.* from Stripe) is a genuinely
-- different thing from a claim (internal/dispute, claims table): a claim is
-- a buyer opening a dispute inside our own UI, negotiated/adjudicated by us;
-- a chargeback is the buyer going straight to their card issuer instead,
-- with Stripe as the only intermediary. It can happen on an order that never
-- had a claim filed at all, and — because separate charges and transfers
-- (docs/Legal_MoneyTransitter.md) means every charge lives on the
-- platform's own Stripe account — it debits the platform's balance
-- directly, never the seller's, no matter what state the order is in.
--
-- status mirrors Stripe's own Dispute.Status enum verbatim (see
-- stripe-go/v82's Dispute type) rather than inventing a parallel one —
-- 'won'/'warning_closed'/'prevented' resolve in the platform's favor,
-- 'lost' means the disputed amount is gone for good, the rest are still
-- pending. order_was_released_at_creation is a point-in-time fact captured
-- when the dispute first arrived — did the seller already get a Transfer
-- for this order before the chargeback landed — since that's exactly the
-- distinction between "we can still just not release" and "this is a
-- real, already-realized platform loss."
create table chargebacks (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id),
    stripe_dispute_id text not null unique,
    status text not null check (status in (
        'warning_needs_response', 'warning_under_review', 'warning_closed',
        'needs_response', 'under_review', 'won', 'lost', 'prevented'
    )),
    reason text,
    amount_cents bigint not null,
    order_was_released_at_creation boolean not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index chargebacks_order_id_idx on chargebacks (order_id);
