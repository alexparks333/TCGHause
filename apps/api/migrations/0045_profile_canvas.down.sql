drop policy if exists "users can delete their own profile canvas" on storage.objects;
drop policy if exists "authenticated users can view their own profile canvas" on storage.objects;
drop policy if exists "authenticated users can upload their own profile canvas" on storage.objects;

delete from storage.objects where bucket_id = 'profile-canvas';
delete from storage.buckets where id = 'profile-canvas';

alter table users drop column profile_canvas;
