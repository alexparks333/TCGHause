-- Fixes a real bug found during end-to-end testing: DELETE on
-- storage.objects needs the row to be visible via a SELECT policy first
-- (the "public bucket bypasses RLS" behavior only applies to the anonymous
-- CDN-style /object/public/... download endpoint, not authenticated
-- management operations like delete). Without this, deleteListingPhoto()
-- silently failed with a generic "Access denied" for the file's own owner.
create policy "authenticated users can view their own listing photos"
on storage.objects for select
to authenticated
using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);
