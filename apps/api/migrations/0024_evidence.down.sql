drop policy if exists "order participants can view evidence" on storage.objects;
drop policy if exists "order participants can upload evidence" on storage.objects;
delete from storage.buckets where id = 'order-evidence';
drop table if exists order_evidence;
