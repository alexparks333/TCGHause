-- New notification kinds for "someone left you a review" (feedback.Upsert
-- for seller_review, buyerreview.Upsert for buyer_review) — see
-- internal/notification's KindSellerReviewReceived/KindBuyerReviewReceived.
--
-- The existing unique constraint (0016_notifications_one_per_listing) was
-- (user_id, listing_id): one notification per listing per user, so any
-- new event for that listing collapses into the same row (a bidding
-- war's outbid -> outbid -> won chain all become one row, latest kind
-- wins) — correct, since a given user can only ever be in one of those
-- four states at a time for a given listing. A review breaks that
-- assumption: the same seller can get a real 'sold' notification for a
-- listing and, independently, a later 'seller_review' notification for
-- that same listing, and the two must NOT collapse into each other —
-- unlike an outbid that gets superseded by a win, both of these are
-- "still true" at once.
--
-- Widening the single constraint to (user_id, listing_id, kind) (an
-- earlier version of this migration did exactly that) would fix the
-- review case but silently break the original one: outbid -> won for the
-- same listing would stop collapsing, since 'outbid' and 'won' no longer
-- match on the same key, leaving a stale unread 'outbid' notification
-- sitting next to the real 'won' one forever. Splitting into two partial
-- unique indexes — one scoped to the four auction-outcome kinds
-- (preserving the original collapsing exactly), one scoped to the two
-- review kinds (so a resubmitted review still collapses into one row, but
-- never contends with the auction-outcome row for that listing) — keeps
-- both behaviors correct. notification.Create picks the matching ON
-- CONFLICT target based on which kind it's inserting.
alter table notifications drop constraint notifications_user_id_listing_id_key;

create unique index notifications_user_id_listing_id_outcome_key on notifications (user_id, listing_id)
    where kind in ('won', 'sold', 'outbid', 'bought');
create unique index notifications_user_id_listing_id_review_key on notifications (user_id, listing_id)
    where kind in ('seller_review', 'buyer_review');

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in ('won', 'sold', 'outbid', 'bought', 'seller_review', 'buyer_review'));
