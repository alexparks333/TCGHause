-- Audit trail for listing photo edits (CLAUDE.md's Edit Listing photo
-- feature): every time a seller adds, removes, or reorders photos on a
-- still-editable listing (fixed-price, or an auction with no bids yet),
-- Update records the full before/after image_urls arrays here. Exists so a
-- dispute reviewer can check a "the seller swapped the photos right before
-- it sold" claim against a real record instead of taking either side's word
-- for it — see internal/listing.PhotoHistory and the admin claim detail page.
create table listing_photo_edits (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid not null references listings(id),
    seller_id uuid not null references users(id),
    before_image_urls text[] not null,
    after_image_urls text[] not null,
    created_at timestamptz not null default now()
);

create index listing_photo_edits_listing_id_idx on listing_photo_edits (listing_id, created_at desc);
