alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in ('won', 'sold', 'outbid', 'bought'));

drop index notifications_user_id_listing_id_review_key;
drop index notifications_user_id_listing_id_outcome_key;
alter table notifications add constraint notifications_user_id_listing_id_key
    unique (user_id, listing_id);
