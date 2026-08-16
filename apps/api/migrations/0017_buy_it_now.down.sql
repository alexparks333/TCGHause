alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in ('won', 'sold', 'outbid'));

alter table listings drop column if exists seller_celebrated_at;
alter table listings drop column if exists buyer_celebrated_at;
alter table listings drop column if exists sold_at;
alter table listings drop column if exists buyer_id;

alter table auctions drop constraint if exists auctions_outcome_check;
alter table auctions add constraint auctions_outcome_check
    check (outcome in ('sold', 'no_bids'));
alter table auctions drop column if exists buy_it_now_price_cents;
