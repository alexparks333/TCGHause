alter table watchlist disable row level security;
drop index if exists watchlist_user_id_idx;
drop index if exists watchlist_listing_id_idx;
drop table if exists watchlist;
