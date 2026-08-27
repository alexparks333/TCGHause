-- First slice of the "beautify your profile" feature (CLAUDE.md's
-- account/profile page) — lets a seller scatter the tier-icon stickers
-- around their profile board. A jsonb array rather than a table: the
-- client always saves the whole arrangement at once (drag stickers, hit
-- Save), so there's no per-sticker row lifecycle to model, just a blob
-- that gets fully overwritten on each save, same shape as how the client
-- treats it (a canvas, not a list of independent records).
alter table users add column profile_stickers jsonb not null default '[]'::jsonb;
