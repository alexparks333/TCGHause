alter table orders drop constraint orders_shipping_preset_check;
update orders set shipping_preset = case
    when shipping_preset = 'shippo_ground_advantage' then 'tracked'
    when shipping_preset is not null then 'standard'
    else shipping_preset
end;
alter table orders rename column shipping_preset to shipping_tier;
alter table orders add constraint orders_shipping_tier_check
    check (shipping_tier = any (array['standard', 'tracked', 'signature']));

alter table listings drop column estimated_shipping_cents;

alter table listings drop constraint listings_shipping_preset_check;
update listings set shipping_preset = case
    when shipping_preset = 'shippo_ground_advantage' then 'tracked'
    else 'standard'
end;
alter table listings rename column shipping_preset to shipping_tier;
alter table listings alter column shipping_tier set default 'standard';
alter table listings add constraint listings_shipping_tier_check
    check (shipping_tier = any (array['standard', 'tracked', 'signature']));
