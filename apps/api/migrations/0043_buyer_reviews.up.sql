-- Buyer-side mirror of seller_reviews (0009/0012/0013), scoped to CLAUDE.md
-- §6.3's reputation system but for the other side of a trade: only the
-- seller who actually sold to a buyer can rate them. Unlike seller_reviews
-- (keyed on listing_id, because at the time it needed a union of "won an
-- auction" or "bought a fixed listing" to prove a purchase happened),
-- internal/order now exists and already pins exactly one buyer_id/seller_id
-- per completed sale — so a buyer review is naturally one-per-order, and
-- order_id being unique is enough to enforce that on its own (no compound
-- unique key needed, since an order has exactly one seller who could ever
-- be the reviewer).
create table buyer_reviews (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null unique references orders(id),
    buyer_id uuid not null references users(id),
    reviewer_id uuid not null references users(id),
    rating smallint not null check (rating between 1 and 5),
    tag text not null check (tag in ('trustworthy', 'suspicious', 'aggressive')),
    comment text check (comment is null or char_length(comment) <= 1000),
    created_at timestamptz not null default now()
);
create index buyer_reviews_buyer_id_idx on buyer_reviews (buyer_id);

alter table buyer_reviews enable row level security;
