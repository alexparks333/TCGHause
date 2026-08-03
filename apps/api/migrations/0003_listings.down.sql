alter table bids disable row level security;
alter table auctions disable row level security;
alter table listings disable row level security;

drop index if exists bids_bidder_id_idx;
drop index if exists bids_auction_listing_id_idx;
drop table if exists bids;
drop table if exists auctions;

drop index if exists listings_status_idx;
drop index if exists listings_seller_id_idx;
drop table if exists listings;
