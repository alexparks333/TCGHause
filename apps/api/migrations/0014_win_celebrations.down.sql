drop index if exists auctions_uncelebrated_wins_idx;
alter table auctions drop column if exists seller_celebrated_at;
alter table auctions drop column if exists buyer_celebrated_at;
