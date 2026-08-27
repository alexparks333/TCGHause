-- EasyPost's account-verification wall never cleared (see the shipping
-- label purchase feature's own history) — the label vendor is Shippo now,
-- not EasyPost. easypost_shipment_id was already a vendor-specific name
-- baked into the schema; renaming it here rather than leaving a
-- permanently misleading column now that a different vendor is behind it.
alter table orders rename column easypost_shipment_id to provider_shipment_id;
