-- Lets a seller with a real Buy It Now price (a fixed-price listing's own
-- price_cents, or an auction's optional buy_it_now_price_cents) opt into
-- accepting offers below that price, with a real floor a buyer can't send
-- an offer under. Lives on listings (not auctions) since it's the same
-- toggle regardless of format — the BIN price it's measured against is
-- just read from wherever that format keeps it (internal/listing.Create's
-- validation enforces min_offer_cents is only ever set alongside a real
-- BIN price, and is strictly less than it).
alter table listings add column allow_offers boolean not null default false;
alter table listings add column min_offer_cents bigint;
