-- New notification kinds for the offers feature (migrations 0049/0050,
-- internal/offer): 'offer_received' (a buyer sent the seller an offer),
-- 'offer_accepted'/'offer_declined' (the seller responded, to the buyer).
--
-- Deliberately NOT added to either existing partial unique index
-- (notifications_user_id_listing_id_outcome_key /
-- ..._review_key, migration 0047). Those exist to collapse a *sequence of
-- states about the same thing* into one row (a bidding war's outbid ->
-- outbid -> won chain; a resubmitted review) — correct there because a
-- user can only be in one of those states at a time for a given listing.
-- Offers don't fit that shape: a listing can have several different
-- buyers each with their own live pending offer at once, and the seller
-- needs to see each one, not have a second buyer's offer silently
-- overwrite the first's notification row just because they share a
-- listing_id. So offer-kind notifications get a plain insert with no ON
-- CONFLICT target at all (see notification.CreateForOffer) — every offer
-- event is its own row, disambiguated by the new offer_id column below
-- rather than collapsed by listing_id the way the other four kinds are.
alter table notifications add column offer_id uuid references offers(id);

alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in (
        'won', 'sold', 'outbid', 'bought', 'seller_review', 'buyer_review',
        'offer_received', 'offer_accepted', 'offer_declined'
    ));
