-- Real listings, auctions, and bids — the first non-account domain data.
-- Money is always integer cents (bigint), never float, per CLAUDE.md §5.1.

create table listings (
    id                  uuid primary key default gen_random_uuid(),
    seller_id           uuid not null references users(id),
    title               text not null,
    game                text not null check (game in (
                            'Pokémon', 'Magic: The Gathering', 'Yu-Gi-Oh!',
                            'Disney Lorcana', 'Riftbound', 'Sports Cards'
                        )),
    set_name            text not null,
    card_number         text,
    rarity              text,
    condition           text not null,
    is_graded           boolean not null default false,
    grading_company     text check (grading_company in ('PSA', 'BGS', 'CGC') or grading_company is null),
    grade               text,
    cert_number         text,
    format              text not null check (format in ('auction', 'fixed')),
    price_cents         bigint,                                  -- fixed-price only
    free_shipping       boolean not null default false,
    shipping_cost_cents bigint not null default 0,
    status              text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
    created_at          timestamptz not null default now()
);

create index listings_seller_id_idx on listings (seller_id);
create index listings_status_idx on listings (status);

-- 1:1 with an auction-format listing. current_price/high_bidder/version are
-- the fields bid placement writes to — version is the optimistic-concurrency
-- guard so two simultaneous bids can never both "win" (CLAUDE.md §5.3).
create table auctions (
    listing_id          uuid primary key references listings(id),
    starting_bid_cents  bigint not null,
    current_price_cents bigint not null,
    high_bidder_id      uuid references users(id),
    bid_count           integer not null default 0,
    ends_at             timestamptz not null,
    version             bigint not null default 0,
    created_at          timestamptz not null default now()
);

-- Every bid a user has placed, including their private proxy max — never
-- exposed to other bidders, only the resulting current_price is public.
create table bids (
    id                  uuid primary key default gen_random_uuid(),
    auction_listing_id  uuid not null references auctions(listing_id),
    bidder_id           uuid not null references users(id),
    max_bid_cents       bigint not null,
    placed_at           timestamptz not null default now()
);

create index bids_auction_listing_id_idx on bids (auction_listing_id);
create index bids_bidder_id_idx on bids (bidder_id);

alter table listings enable row level security;
alter table auctions enable row level security;
alter table bids enable row level security;
