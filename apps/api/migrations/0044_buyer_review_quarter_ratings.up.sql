-- Widens buyer_reviews.rating from a whole-star smallint to quarter-star
-- granularity (1, 1.25, 1.5, ..., 5) — product decision so a seller isn't
-- forced to round a buyer up/down to the nearest whole star. numeric(3,2)
-- (not float) so "is this actually a quarter increment" is an exact
-- comparison, not a floating-point one.
alter table buyer_reviews drop constraint buyer_reviews_rating_check;
alter table buyer_reviews alter column rating type numeric(3,2) using rating::numeric(3,2);
alter table buyer_reviews add constraint buyer_reviews_rating_check
    check (rating between 1 and 5 and round(rating * 4) = rating * 4);
