-- Real EasyPost label purchase (docs/Shipping_Research.md) — a seller picks
-- a shipping preset at listing time (three presets, one per value-driven
-- service tier: standard/tracked/signature), and the actual order snapshots
-- whichever tier is stricter between that preset and what the final sale
-- price requires (internal/shipping.RequiredTier) — a low-starting-bid
-- auction that closes high must never ship under-tracked just because the
-- seller picked "standard" back when the listing went up.
alter table listings add column shipping_tier text not null default 'standard'
    check (shipping_tier in ('standard', 'tracked', 'signature'));

alter table orders add column shipping_tier text
    check (shipping_tier in ('standard', 'tracked', 'signature'));
-- signature_required is a denormalized bool alongside shipping_tier so the
-- seller-facing "buy label" flow and MarkDelivered's future signature-check
-- can both check one cheap column rather than string-comparing the tier
-- everywhere.
alter table orders add column signature_required boolean not null default false;

-- EasyPost's Shipment id — needed to correlate this order back to EasyPost
-- for refund/void calls and to look up tracker status independent of the
-- carrier webhook (internal/shipping/webhook.go is still the carrier-
-- agnostic stand-in described in that file's doc comment; this column is
-- what a real EasyPost tracker-webhook handler will join on later).
alter table orders add column easypost_shipment_id text;
-- label_cost_cents is what EasyPost actually charged for postage — stored
-- so it's answerable later ("why did this order net less than the quote"),
-- pkg/money.Cents shape (CLAUDE.md §5.1), never float64.
alter table orders add column label_cost_cents bigint;
alter table orders add column label_url text;
