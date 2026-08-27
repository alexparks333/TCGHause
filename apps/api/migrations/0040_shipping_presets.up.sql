-- Replaces the old 3-value shipping_tier (standard/tracked/signature) with
-- 5 concrete presets, each locked to a real fulfillment mechanism —
-- Shippo (packages) or Pitney Bowes (tracked envelopes, IMb). See
-- internal/shipping's package doc for the full policy: mechanism is fixed
-- per preset so a seller can never declare one shipping method and
-- fulfill with another.
alter table listings drop constraint listings_shipping_tier_check;
alter table listings rename column shipping_tier to shipping_preset;

-- Remap existing values before the new, stricter constraint goes on —
-- 'standard' becomes the new cheap default (tracked_envelope); 'tracked'
-- and 'signature' both become the package mechanism (signature itself is
-- no longer a listing-level preset at all, just an order-level flag
-- derived from price at sale time, same as before).
update listings set shipping_preset = case shipping_preset
    when 'standard' then 'tracked_envelope'
    when 'tracked' then 'shippo_ground_advantage'
    when 'signature' then 'shippo_ground_advantage'
    else shipping_preset
end;

alter table listings alter column shipping_preset set default 'tracked_envelope';
alter table listings add constraint listings_shipping_preset_check
    check (shipping_preset in (
        'free_envelope', 'free_bubble_mailer', 'free_box',
        'tracked_envelope', 'shippo_ground_advantage'
    ));

-- Only ever populated for the shippo_ground_advantage preset — a one-time
-- rate-shop estimate computed at listing-creation time (seller's address to
-- a representative reference point; no buyer exists yet to quote a real
-- rate against). Explicitly an estimate, never the actual charged amount —
-- the real charge is computed fresh at checkout against the real buyer
-- address, same "never trust a stale precomputed price for money that
-- actually moves" rule as everywhere else in this codebase.
alter table listings add column estimated_shipping_cents bigint;

alter table orders drop constraint orders_shipping_tier_check;
alter table orders rename column shipping_tier to shipping_preset;
update orders set shipping_preset = case shipping_preset
    when 'standard' then 'tracked_envelope'
    when 'tracked' then 'shippo_ground_advantage'
    when 'signature' then 'shippo_ground_advantage'
    else shipping_preset
end
where shipping_preset is not null;
alter table orders add constraint orders_shipping_preset_check
    check (shipping_preset in (
        'free_envelope', 'free_bubble_mailer', 'free_box',
        'tracked_envelope', 'shippo_ground_advantage'
    ));
