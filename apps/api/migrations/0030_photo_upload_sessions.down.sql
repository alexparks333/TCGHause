alter table photo_upload_sessions disable row level security;
drop index if exists photo_upload_sessions_expires_at_idx;
drop index if exists photo_upload_sessions_user_id_idx;
drop table if exists photo_upload_sessions;
