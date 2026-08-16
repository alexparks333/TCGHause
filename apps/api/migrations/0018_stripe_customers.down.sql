drop index if exists users_stripe_customer_id_idx;
alter table users drop column if exists stripe_customer_id;
