alter table seller_reviews drop column if exists seller_reply_at;
alter table seller_reviews drop column if exists seller_reply;

alter table seller_reviews add column rating smallint;
update seller_reviews set rating = round((condition_accuracy + shipping_speed + trustworthiness) / 3.0);
alter table seller_reviews alter column rating set not null;
alter table seller_reviews add constraint seller_reviews_rating_check check (rating between 1 and 5);

alter table seller_reviews drop column if exists trustworthiness;
alter table seller_reviews drop column if exists shipping_speed;
alter table seller_reviews drop column if exists condition_accuracy;
