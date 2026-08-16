-- A user should only ever see one notification per listing, always
-- reflecting its latest status — otherwise an active bidding war (outbid,
-- rebid, outbid again...) fills the bell with duplicate entries for the
-- same item instead of one that just updates and re-surfaces as unread.
-- notification.Create becomes an upsert on this constraint: a repeat event
-- for the same (user, listing) updates the existing row's kind and bumps
-- it back to unread/newest instead of inserting a new one. Self-bidding is
-- blocked (ErrSelfBid), so a user is never both the buyer and the seller
-- notified about the same listing — no ambiguity between e.g. "outbid" and
-- "sold" ever colliding on this key.
alter table notifications add constraint notifications_user_id_listing_id_key
    unique (user_id, listing_id);
