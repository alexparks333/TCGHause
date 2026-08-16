-- The authoritative order/payment/fulfillment state machine (design doc v2
-- §5, internal/order). listings/auctions keep owning "what's being sold and
-- its bidding history" unchanged (listings.buyer_id/paid_at/sold_at,
-- auctions.high_bidder_id/paid_at stay as cheap "who owns this" facts other
-- read paths already depend on) — orders is the new authoritative table for
-- "what state is the money/shipment in," an explicit state enum + CAS
-- transition table instead of the scattered-boolean-flags pattern those
-- older columns are (CLAUDE.md §5.2).
create table orders (
    id uuid primary key default gen_random_uuid(),
    buyer_id uuid not null references users(id),
    seller_id uuid not null references users(id),
    state text not null default 'created' check (state in (
        'created', 'payment_pending', 'paid', 'awaiting_ship', 'shipped',
        'delivered', 'claim_window', 'released', 'claim_open', 'refunded', 'cancelled'
    )),
    rail text check (rail in ('card', 'ach')),
    -- tier_at_sale/tier_pct_at_sale are a permanent snapshot at the moment
    -- of sale — NEVER recomputed from the seller's current tier
    -- afterwards, or historical reporting breaks the moment anyone gets
    -- promoted (design doc v2 §10).
    tier_at_sale text not null,
    tier_pct_at_sale numeric(5, 4) not null,
    subtotal_cents bigint not null,
    shipping_cents bigint not null default 0,
    fee_base_cents bigint not null,
    seller_fee_cents bigint not null,
    seller_net_cents bigint not null,
    discount_cents bigint not null default 0,
    tax_cents bigint not null default 0,
    charged_cents bigint not null,
    processing_cost_cents bigint not null,
    stripe_payment_intent_id text,
    stripe_charge_id text,
    application_fee_cents bigint,
    tracking_number text,
    carrier text,
    shipped_at timestamptz,
    delivered_at timestamptz,
    claim_deadline timestamptz,
    released_at timestamptz,
    payout_id uuid,
    version integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index orders_buyer_id_idx on orders (buyer_id, created_at desc);
create index orders_seller_id_idx on orders (seller_id, created_at desc);
create index orders_state_idx on orders (state);

create table order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id),
    listing_id uuid not null references listings(id),
    price_cents bigint not null,
    created_at timestamptz not null default now()
);
-- A listing sells at most once, ever — belt-and-suspenders alongside the
-- ownership compare-and-swap in internal/auction/internal/listing that
-- already enforces this at the listings/auctions layer.
create unique index order_items_listing_id_idx on order_items (listing_id);
create index order_items_order_id_idx on order_items (order_id);
