alter table buyer_reviews drop constraint buyer_reviews_rating_check;
alter table buyer_reviews alter column rating type smallint using round(rating)::smallint;
alter table buyer_reviews add constraint buyer_reviews_rating_check check (rating >= 1 and rating <= 5);
