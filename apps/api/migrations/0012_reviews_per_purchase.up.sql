-- Reviews used to be capped at one per (seller, reviewer) pair, gated on
-- "have you ever won anything from this seller" (HasWonAuctionFrom). That
-- let a buyer who won 5 auctions from the same seller leave only one
-- review total, with no link to which purchase it was even about — and
-- it's a weaker gate than it looks, since eBay's own model (and the
-- product decision here) is feedback per completed transaction, not per
-- relationship. This ties every review to one specific won auction and
-- allows exactly one review per purchase, not one per seller.

alter table seller_reviews add column listing_id uuid references listings(id);

-- Backfill: attach each pre-existing review to the reviewer's most recent
-- win from that seller as of when the review was written — the closest
-- honest reconstruction of "which purchase was this actually about" for
-- rows written before listing_id existed. Every such review necessarily
-- has at least one matching row, since HasWonAuctionFrom was the gate that
-- let it be written in the first place.
update seller_reviews r
set listing_id = (
    select a.listing_id
    from auctions a
    join listings l on l.id = a.listing_id
    where l.seller_id = r.seller_id
      and a.high_bidder_id = r.reviewer_id
      and a.ends_at <= r.created_at
    order by a.ends_at desc
    limit 1
);

alter table seller_reviews alter column listing_id set not null;

alter table seller_reviews drop constraint seller_reviews_seller_id_reviewer_id_key;
alter table seller_reviews add constraint seller_reviews_reviewer_id_listing_id_key
    unique (reviewer_id, listing_id);

create index seller_reviews_listing_id_idx on seller_reviews (listing_id);
