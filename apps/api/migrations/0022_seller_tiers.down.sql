drop table if exists tier_events;
alter table users drop column if exists dispute_rate_90d;
alter table users drop column if exists cumulative_orders;
alter table users drop column if exists tier_since;
alter table users drop column if exists tier;
