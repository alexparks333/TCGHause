-- Shipping evidence (design doc v2 §5.3): SHIPPED is unreachable without a
-- validated tracking number and photos of the card (front/back) and the
-- sealed package. Buyers are also (non-blockingly) prompted for an arrival
-- photo before unpacking, for expedited claim handling later.
create table order_evidence (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id),
    uploaded_by uuid not null references users(id),
    type text not null check (type in (
        'tracking_number', 'card_front', 'card_back', 'package_sealed', 'arrival_photo', 'claim_photo'
    )),
    url text not null,
    created_at timestamptz not null default now()
);
create index order_evidence_order_id_idx on order_evidence (order_id);

-- Real photo storage, same Supabase Storage pattern as listing-photos
-- (migration 0004, CLAUDE.md §6.13) — uploads happen client-side, scoped to
-- the uploading order's own folder ({order_id}/{filename}). Unlike
-- listing-photos, the INSERT policy checks the uploader is actually a
-- participant (buyer or seller) of that specific order, not just "any
-- authenticated user uploading to their own folder" — evidence belongs to
-- an order, not to whichever user happens to be uploading it.
--
-- Known simplification, not full privacy enforcement: the bucket is public
-- (like listing-photos) so evidence photos can be displayed with a plain
-- URL rather than requiring signed-URL plumbing from the backend. Paths
-- are unguessable (random order UUID + random filename), which is not the
-- same as real per-order read privacy — a genuinely private bucket with
-- signed URLs is a real follow-up, not attempted here to avoid landing a
-- half-finished signed-URL implementation. Write access IS properly
-- enforced below (only an order's buyer/seller can upload into its folder).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'order-evidence', 'order-evidence', true,
    10485760, -- 10MB
    array['image/jpeg', 'image/png', 'image/webp']
);

create policy "order participants can upload evidence"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'order-evidence'
    and exists (
        select 1 from orders
        where orders.id::text = (storage.foldername(name))[1]
        and (orders.buyer_id = (select auth.uid()) or orders.seller_id = (select auth.uid()))
    )
);

-- Delete needs its own SELECT policy for the same reason discovered in
-- 0005_listing_photos_select_policy — the public bucket's RLS bypass only
-- covers the anonymous /object/public/... read endpoint, not authenticated
-- management operations.
create policy "order participants can view evidence"
on storage.objects for select
to authenticated
using (
    bucket_id = 'order-evidence'
    and exists (
        select 1 from orders
        where orders.id::text = (storage.foldername(name))[1]
        and (orders.buyer_id = (select auth.uid()) or orders.seller_id = (select auth.uid()))
    )
);
