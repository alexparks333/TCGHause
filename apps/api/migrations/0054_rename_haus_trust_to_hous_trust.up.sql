-- Rebrand: "Haus Trust" -> "Hous Trust" (matches AuctionHous, not a typo of
-- "Haus" left over from an earlier working name). Historical migrations
-- (0022, 0036, 0046) are left saying "haus_trust" on purpose — they're an
-- accurate record of what actually ran at the time; this migration is the
-- one that performs the real rename, backfilling every already-stored row
-- rather than just relabeling the column/constraint going forward.
alter table users drop constraint users_tier_check;
update users set tier = 'hous_trust' where tier = 'haus_trust';
alter table users add constraint users_tier_check
    check (tier in ('new', 'bronze', 'silver', 'gold', 'platinum', 'hous_trust'));

alter table users rename column haus_trust_custom_pct to hous_trust_custom_pct;

update tier_events set from_tier = 'hous_trust' where from_tier = 'haus_trust';
update tier_events set to_tier = 'hous_trust' where to_tier = 'haus_trust';
update tier_events set reason = 'hous_trust_application_approved'
    where reason = 'haus_trust_application_approved';

alter table haus_trust_applications rename to hous_trust_applications;
alter index haus_trust_applications_seller_id_idx rename to hous_trust_applications_seller_id_idx;
