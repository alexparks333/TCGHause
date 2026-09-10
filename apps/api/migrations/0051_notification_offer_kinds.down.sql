alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in ('won', 'sold', 'outbid', 'bought', 'seller_review', 'buyer_review'));

alter table notifications drop column offer_id;
