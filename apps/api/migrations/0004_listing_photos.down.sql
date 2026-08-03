alter table listings drop column if exists image_urls;

drop policy if exists "users can delete their own listing photos" on storage.objects;
drop policy if exists "authenticated users can upload their own listing photos" on storage.objects;

delete from storage.buckets where id = 'listing-photos';
