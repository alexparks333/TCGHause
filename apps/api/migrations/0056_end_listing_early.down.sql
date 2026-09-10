alter table auctions drop column if exists cancel_reason;

alter table auctions drop constraint auctions_outcome_check;
alter table auctions add constraint auctions_outcome_check
    check (outcome in ('sold', 'no_bids', 'bought_now'));
