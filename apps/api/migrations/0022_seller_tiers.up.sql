-- Seller trust-tier state (design doc v2 §3). Schema only in this
-- migration — the promotion/demotion engine (internal/seller, cumulative
-- order counting, dispute-rate gates, the daily worker recompute) is
-- Phase 7, not built yet. Every seller defaults to 'new' (the entry tier,
-- 7.00% + $0.30 per pkg/fees) until that engine exists. Whether that's the
-- right launch behavior, or a temporary better rate should apply instead,
-- is an explicitly open product decision (design doc v2 §3.7) — the
-- default here deliberately does not bake in an answer; changing it later
-- is a default-value flip plus a backfill, not a schema change.
alter table users add column tier text not null default 'new'
    check (tier in ('new', 'bronze', 'silver', 'gold', 'haus_trust'));
alter table users add column tier_since timestamptz not null default now();
alter table users add column cumulative_orders integer not null default 0;
alter table users add column dispute_rate_90d numeric(5, 4) not null default 0;

-- The audit trail for every tier change, once the engine that writes to it
-- exists (Phase 7). Created now so the schema is ready; empty until then.
create table tier_events (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references users(id),
    from_tier text not null,
    to_tier text not null,
    reason text not null,
    created_at timestamptz not null default now()
);
create index tier_events_seller_id_idx on tier_events (seller_id, created_at desc);
