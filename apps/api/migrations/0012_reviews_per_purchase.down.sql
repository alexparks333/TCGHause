drop index if exists seller_reviews_listing_id_idx;
alter table seller_reviews drop constraint if exists seller_reviews_reviewer_id_listing_id_key;
-- Not guaranteed to succeed if the up-migration allowed multiple reviews
-- per (seller_id, reviewer_id) since it ran — that's the entire point of
-- this migration, so reverting past it can lose that data, same as any
-- other down-migration in this repo that isn't lossless.
alter table seller_reviews add constraint seller_reviews_seller_id_reviewer_id_key
    unique (seller_id, reviewer_id);
alter table seller_reviews drop column if exists listing_id;
