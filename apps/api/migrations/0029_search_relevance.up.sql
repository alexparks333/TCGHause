-- pg_trgm powers typo-tolerant, cross-field search (CLAUDE.md §6.7's search
-- upgrade path) — plain title ILIKE only matched literal substrings of one
-- column, which is why searching "Pokemon" (a separate `game` column, never
-- in the title) or a misspelled/misspaced card name returned nothing.
create extension if not exists pg_trgm with schema extensions;

-- One generated column carrying everything a shopper might type, so search
-- isn't scoped to title alone. Generated (not maintained by app code) so it
-- can never drift out of sync with the row it's derived from.
alter table listings add column search_text text generated always as (
    title || ' ' || game || ' ' || set_name || ' ' || coalesce(card_number, '') ||
    ' ' || coalesce(rarity, '') || ' ' || condition || ' ' ||
    coalesce(grading_company, '') || ' ' || coalesce(grade, '')
) stored;

create index listings_search_text_trgm_idx on listings using gin (search_text extensions.gin_trgm_ops);
