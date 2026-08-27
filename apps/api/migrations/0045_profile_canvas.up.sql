-- Freehand profile painting (CLAUDE.md §6.13-adjacent profile canvas work):
-- the painted layer is a lossless PNG in Supabase Storage, not pixel data in
-- Postgres — this column is just the descriptor {url, width, height} pointing
-- at the current artwork. Nullable on purpose: null = never painted, which the
-- frontend renders as no paint layer at all (distinct from an uploaded
-- fully-transparent PNG).
alter table users add column profile_canvas jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'profile-canvas', 'profile-canvas', true,
    20971520, -- 20MB: a lossless PNG of a tall painted canvas dwarfs a card photo
    array['image/png']
);

-- Same {user_id}/... folder scoping as listing-photos (0004).
create policy "authenticated users can upload their own profile canvas"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'profile-canvas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- The 0005 gotcha, applied up front this time: public = true only bypasses
-- RLS for the anonymous /object/public/... read endpoint. Authenticated
-- management operations (delete of the previous save) need the row visible
-- via an explicit SELECT policy or they fail with a generic "Access denied".
create policy "authenticated users can view their own profile canvas"
on storage.objects for select
to authenticated
using (
    bucket_id = 'profile-canvas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users can delete their own profile canvas"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'profile-canvas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);
