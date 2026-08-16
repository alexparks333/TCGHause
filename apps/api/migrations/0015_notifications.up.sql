-- Persistent, cross-session notifications for the header bell — distinct
-- from the one-time celebration toast (0014_win_celebrations): a
-- celebration plays once and is gone, this is a running list a user can
-- open later, mark read, and revisit. "won"/"sold" fire when cmd/worker
-- closes an auction (internal/auction/close.go); "outbid" fires the
-- instant a new bid displaces the previous high bidder
-- (internal/auction/auction.go's attemptBid) — both write to this table in
-- the same transaction as the state change that caused them, so a
-- notification can never exist without its underlying event actually
-- having committed, or vice versa.
create table notifications (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users(id),
    kind        text not null check (kind in ('won', 'sold', 'outbid')),
    listing_id  uuid not null references listings(id),
    read_at     timestamptz,
    created_at  timestamptz not null default now()
);

-- The hot query is "my notifications, newest first" and "my unread count" —
-- both filter/order on (user_id, created_at), unread additionally on
-- read_at is null.
create index notifications_user_id_created_at_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

alter table notifications enable row level security;
