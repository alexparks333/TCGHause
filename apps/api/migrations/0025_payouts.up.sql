-- Payout batching (design doc v2 §6). Because every charge is a Connect
-- direct charge, funds already sit in the seller's OWN Stripe balance the
-- instant a charge captures — this table tracks *our platform's* Payouts
-- API calls against that balance (payout_cadence, migration 0020, is set
-- to manual on every connected account), never a ledger of money we hold.
create table payouts (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references users(id),
    amount_cents bigint not null,
    stripe_payout_id text,
    status text not null default 'pending' check (status in ('pending', 'in_transit', 'paid', 'failed')),
    kind text not null default 'batched' check (kind in ('batched', 'per_order', 'instant')),
    created_at timestamptz not null default now(),
    paid_at timestamptz
);
create index payouts_seller_id_idx on payouts (seller_id, created_at desc);

create table payout_orders (
    payout_id uuid not null references payouts(id),
    order_id uuid not null references orders(id),
    primary key (payout_id, order_id)
);

alter table orders add constraint orders_payout_id_fkey foreign key (payout_id) references payouts(id);
