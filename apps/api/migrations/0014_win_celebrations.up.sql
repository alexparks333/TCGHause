-- Supports the one-time "Bid Won!" / "Item Sold!" celebration animation:
-- tracks whether the winning bidder and the seller have each already been
-- shown their celebration for a given closed (outcome = 'sold') auction,
-- so it fires exactly once per person per auction — live if they're on the
-- site when cmd/worker closes it (the frontend polls GET /me/celebrations),
-- or on their very next visit otherwise, never both.

alter table auctions add column buyer_celebrated_at timestamptz;
alter table auctions add column seller_celebrated_at timestamptz;

-- The hot query is "auctions this bidder won that haven't been celebrated
-- yet" — listing_id (the seller-side lookup's join key) is already the
-- table's primary key, so only the buyer-side lookup needs a new index.
create index auctions_uncelebrated_wins_idx on auctions (high_bidder_id)
    where outcome = 'sold' and buyer_celebrated_at is null;
