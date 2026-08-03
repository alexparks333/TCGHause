drop index if exists auctions_pending_close_idx;
alter table auctions drop column if exists closed_at;
alter table auctions drop column if exists outcome;

alter table listings drop constraint listings_status_check;
alter table listings add constraint listings_status_check
    check (status in ('active', 'sold', 'cancelled'));
