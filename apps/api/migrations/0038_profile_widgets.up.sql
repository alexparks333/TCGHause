-- Phase 1 of the full profile-canvas editor (see CLAUDE.md's profile
-- customization notes): the seller's own choice of which content widgets
-- (Listings, Favorite Card, ...) appear on their public profile, and in
-- what order. Same append-only-to-the-schema, replace-the-whole-array-on-
-- write shape as profile_stickers (migration 0037) — a jsonb array rather
-- than a table, since the client always saves its full arrangement at once.
alter table users add column profile_widgets jsonb not null default '[]'::jsonb;
