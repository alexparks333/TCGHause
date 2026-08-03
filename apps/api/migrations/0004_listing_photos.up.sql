-- Real photo storage for listings via Supabase Storage — already-provisioned
-- infra (CLAUDE.md tech stack table), not a new external service. See
-- CLAUDE.md §6.13.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'listing-photos', 'listing-photos', true,
    10485760, -- 10MB
    array['image/jpeg', 'image/png', 'image/webp']
);

-- Uploads are scoped to the uploader's own folder ({user_id}/{filename}).
-- This has to work *before* a listing row exists — the Sell wizard uploads
-- photos in step 2, before the listing is created in step 3 — so the check
-- is against the uploader's own auth.uid(), not any listing ownership.
create policy "authenticated users can upload their own listing photos"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can delete their own listing photos"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- No SELECT policy needed: public = true on the bucket bypasses RLS
-- entirely for the /storage/v1/object/public/... read endpoint.

alter table listings add column image_urls text[] not null default '{}';
