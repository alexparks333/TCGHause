-- Two additions to the per-purchase review system (0012):
--
-- 1. Split the single 1-5 rating into three axes (product decision —
--    CLAUDE.md §6.3 sketches four long-term, this ships three): Condition
--    Accuracy, Shipping Speed, Trustworthiness. There's no separate stored
--    "headline" score — a review's overall rating and a seller's overall
--    average are both derived as the mean across axes, same "derive, don't
--    cache" principle as seller tier (CLAUDE.md §5.4).
--
-- 2. Sellers can reply to a review of themselves — exactly one reply per
--    review, stored right on the row rather than a separate table, since
--    it's a strict 1:1 relationship with no threading. Re-submitting
--    replaces the existing reply rather than adding a second one.

alter table seller_reviews add column condition_accuracy smallint check (condition_accuracy between 1 and 5);
alter table seller_reviews add column shipping_speed smallint check (shipping_speed between 1 and 5);
alter table seller_reviews add column trustworthiness smallint check (trustworthiness between 1 and 5);

-- Backfill: there's no per-axis history for reviews written before this
-- migration, so carry the old single rating into all three axes rather
-- than guessing — an honest "we don't know the breakdown" default, not a
-- fabricated one.
update seller_reviews set condition_accuracy = rating, shipping_speed = rating, trustworthiness = rating;

alter table seller_reviews alter column condition_accuracy set not null;
alter table seller_reviews alter column shipping_speed set not null;
alter table seller_reviews alter column trustworthiness set not null;

alter table seller_reviews drop constraint seller_reviews_rating_check;
alter table seller_reviews drop column rating;

alter table seller_reviews add column seller_reply text
    check (seller_reply is null or char_length(seller_reply) <= 1000);
alter table seller_reviews add column seller_reply_at timestamptz;
