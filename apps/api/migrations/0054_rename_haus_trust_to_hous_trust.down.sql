alter index hous_trust_applications_seller_id_idx rename to haus_trust_applications_seller_id_idx;
alter table hous_trust_applications rename to haus_trust_applications;

update tier_events set reason = 'haus_trust_application_approved'
    where reason = 'hous_trust_application_approved';
update tier_events set to_tier = 'haus_trust' where to_tier = 'hous_trust';
update tier_events set from_tier = 'haus_trust' where from_tier = 'hous_trust';

alter table users rename column hous_trust_custom_pct to haus_trust_custom_pct;

alter table users drop constraint users_tier_check;
update users set tier = 'haus_trust' where tier = 'hous_trust';
alter table users add constraint users_tier_check
    check (tier in ('new', 'bronze', 'silver', 'gold', 'platinum', 'haus_trust'));
