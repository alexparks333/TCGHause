-- Superseded by shipping_preset (0040): free-ness is now Preset.IsFree(),
-- and the buyer-facing shipping cost is derived from the preset itself
-- (0 for free_*, TrackedEnvelopeCents for tracked_envelope, a real Shippo
-- quote for shippo_ground_advantage) rather than an arbitrary seller-typed
-- number. Nothing reads these columns anymore.
alter table listings drop column free_shipping;
alter table listings drop column shipping_cost_cents;
