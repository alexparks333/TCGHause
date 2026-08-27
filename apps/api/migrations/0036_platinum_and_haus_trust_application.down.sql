drop table if exists haus_trust_applications;
alter table users drop column if exists haus_trust_custom_pct;

alter table users drop constraint users_tier_check;
alter table users add constraint users_tier_check
    check (tier in ('new', 'bronze', 'silver', 'gold', 'haus_trust'));
