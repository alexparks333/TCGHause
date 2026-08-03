drop table if exists public.seller_reviews;

alter table public.users drop constraint if exists users_bio_length_chk;
alter table public.users drop column if exists bio;
