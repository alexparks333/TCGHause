-- Real offer/negotiation state (internal/offer) — a buyer proposes a price
-- below a listing's Buy It Now price (gated by listings.allow_offers/
-- min_offer_cents, migration 0049), the seller accepts or declines it.
-- Deliberately its own table rather than reusing bids: a bid is a private
-- max in a live proxy-auction system with its own race-safety rules
-- (CLAUDE.md §5.3/§6.1); an offer is a single flat amount on a listing
-- that already has a fixed asking price, with an entirely different
-- lifecycle (pending -> accepted/declined/withdrawn/expired, no bidding
-- war, no current-price concept at all).
create table offers (
    id           uuid primary key default gen_random_uuid(),
    listing_id   uuid not null references listings(id),
    buyer_id     uuid not null references users(id),
    seller_id    uuid not null references users(id),
    amount_cents bigint not null check (amount_cents > 0),
    status       text not null default 'pending' check (status in (
        'pending', 'accepted', 'declined', 'withdrawn', 'expired'
    )),
    created_at    timestamptz not null default now(),
    responded_at  timestamptz
);

-- The hot queries are "offers on this listing" (seller viewing their own
-- listing) and "my sent offers"/"offers I've received across everything
-- I sell" (the account Offers views) — all newest-first.
create index offers_listing_id_created_at_idx on offers (listing_id, created_at desc);
create index offers_buyer_id_created_at_idx on offers (buyer_id, created_at desc);
create index offers_seller_id_created_at_idx on offers (seller_id, created_at desc);

-- A buyer can only have one live (pending) offer on a given listing at a
-- time — sending a new one first requires the old one to resolve
-- (accepted/declined) or be withdrawn, so a seller's inbox never fills up
-- with the same buyer's stale, superseded numbers sitting next to their
-- latest one.
create unique index offers_one_pending_per_buyer_listing_idx
    on offers (listing_id, buyer_id) where status = 'pending';

alter table offers enable row level security;
