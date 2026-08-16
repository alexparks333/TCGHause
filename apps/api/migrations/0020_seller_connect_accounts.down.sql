drop index if exists users_stripe_account_id_idx;
alter table users drop column if exists payout_cadence;
alter table users drop column if exists connect_onboarded_at;
alter table users drop column if exists connect_details_submitted;
alter table users drop column if exists connect_payouts_enabled;
alter table users drop column if exists connect_charges_enabled;
alter table users drop column if exists stripe_account_id;
